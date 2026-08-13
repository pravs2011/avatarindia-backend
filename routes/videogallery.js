const router = require("express").Router();
const VideoGallery = require("../models/VideoGallery");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for multiple video upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/videos");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "video-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// File filter to accept only video files
const fileFilter = (req, file, cb) => {
  const allowedTypes = /mp4|webm|ogg|mov|m4v/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  // Accept when the mimetype matches OR the client sent a generic binary type
  // (some clients send application/octet-stream even for valid video extensions)
  const mimetype =
    allowedTypes.test(file.mimetype) ||
    file.mimetype === "application/octet-stream";

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only video files are allowed!"));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB limit per video
  },
  fileFilter: fileFilter,
});

// Helper to delete an uploaded video file
const deleteVideoFile = (videoPath) => {
  if (!videoPath) return;
  const filePath = path.join(__dirname, "../public", videoPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// Normalize a YouTube link/ID to its bare 11-character video ID.
// Returns "" for anything that isn't a valid YouTube reference.
const normalizeYouTubeId = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";

  const patterns = [
    /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Accept a bare 11-character video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;

  return "";
};

// Parse a (possibly single or repeated) youtube_urls form field into IDs.
// Also accepts a JSON array string (e.g. "[\"id1\",\"id2\"]").
const parseYoutubeUrls = (field) => {
  if (field === undefined || field === null) return undefined;
  let values = Array.isArray(field) ? field : [field];
  // When only a single string arrived, it may be a JSON array
  if (values.length === 1 && typeof values[0] === "string") {
    const trimmed = values[0].trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) values = parsed;
      } catch (e) {
        /* not JSON — fall through */
      }
    }
  }
  return values.map(normalizeYouTubeId).filter((id) => id.length > 0);
};

// Parse the youtube_meta form field (a JSON string of metadata objects)
// into an array of { id, title, author, thumbnail }, dropping anything that
// isn't a valid object or whose id isn't in the given URLs list.
const parseYoutubeMeta = (field, ids) => {
  if (field === undefined || field === null || field === "") return [];
  let parsed;
  try {
    parsed = typeof field === "string" ? JSON.parse(field) : field;
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const clean = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const id = normalizeYouTubeId(item.id);
    if (!id || !ids.includes(id)) continue;
    clean.push({
      id,
      title: String(item.title || "").trim().slice(0, 255),
      author: String(item.author || "").trim().slice(0, 120),
      thumbnail: String(item.thumbnail || "").trim().slice(0, 500),
    });
  }
  return clean;
};

// Fetch video metadata (title, channel, thumbnail) from YouTube's free,
// API-key-free oEmbed endpoint. Returns null when it can't be reached.
const fetchYouTubeMeta = async (id) => {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${id}`
    )}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "avatarindia-backend" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        id,
        title: String(data.title || "").trim().slice(0, 255),
        author: String(data.author_name || "").trim().slice(0, 120),
        thumbnail: String(data.thumbnail_url || "").trim().slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return null;
  }
};

// Merge client-provided metadata with fresh oEmbed lookups for any IDs that
// are missing metadata, so stored records always carry title/author.
const completeYouTubeMeta = async (ids, providedMeta) => {
  const provided = parseYoutubeMeta(providedMeta, ids);
  const byId = new Map(provided.map((m) => [m.id, m]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    // Fetch in parallel; failures are simply skipped
    const results = await Promise.all(missing.map(fetchYouTubeMeta));
    results.forEach((meta) => {
      if (meta && !byId.has(meta.id)) byId.set(meta.id, meta);
    });
  }

  // Keep the same order as ids, dropping anything not in the list
  return ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
};

// Parse the existing_video_order / existing_order form field (a JSON array
// of existing file paths) into an array of strings, or null when absent.
const parseOrderList = (field) => {
  if (field === undefined || field === null || field === "") return null;
  try {
    const parsed = JSON.parse(field);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
  } catch (e) {
    return null;
  }
};

// Validate that a submitted order list is a permutation of the current set.
// Returns true only when every path exists and no duplicates/omissions occur.
const isPermutation = (order, current) => {
  if (!Array.isArray(order) || !Array.isArray(current)) return false;
  if (order.length !== current.length) return false;
  const currentSet = new Set(current);
  const seen = new Set();
  for (const item of order) {
    if (!currentSet.has(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
};

// Helper to clean up files when an operation fails
const cleanupUploadedFiles = (files) => {
  if (files && files.length > 0) {
    files.forEach((file) => {
      const filePath = path.join(__dirname, "../public/videos", file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  }
};

// (R) Read / Get All Video Galleries (public)
router.get("/", async (req, res) => {
  try {
    // Respect the admin-set sort_order first, then fall back to newest
    const galleries = await VideoGallery.find().sort({ sort_order: 1, createdAt: -1 });

    res.json({
      galleries: galleries,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (R) Read / Get Single Video Gallery by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const gallery = await VideoGallery.findById(req.params.id);
    if (!gallery) {
      return res.status(404).json({ error: "Video gallery not found" });
    }
    res.json({
      gallery: gallery,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (C) Create / Add a Video Gallery Event
router.post("/add", verify, upload.array("videos", 10), async (req, res) => {
  try {
    // Prepare gallery data
    const galleryData = {
      title: req.body.title,
      description: req.body.description || "",
      videos: [],
      youtube_urls: [],
    };

    // Add video URLs if files were uploaded
    if (req.files && req.files.length > 0) {
      // Save paths without "public" prefix
      galleryData.videos = req.files.map((file) => `videos/${file.filename}`);
    }

    // Add YouTube video IDs if provided (normalized to bare 11-char IDs)
    const youtubeUrls = parseYoutubeUrls(req.body.youtube_urls);
    if (youtubeUrls !== undefined) {
      galleryData.youtube_urls = youtubeUrls;
      // Pull titles/descriptions from YouTube and store them alongside
      galleryData.youtube_meta = await completeYouTubeMeta(
        youtubeUrls,
        req.body.youtube_meta
      );
    }

    const gallery = new VideoGallery(galleryData);

    const log_id = await createLog({
      data: JSON.stringify({ ...galleryData }),
      user: req.user._id,
      activity: "Create",
      page: "VideoGallery",
      ip_information: req.ip,
      route: "/add",
    });

    const savedGallery = await gallery.save();
    res.json({ gallery: savedGallery._id });
  } catch (err) {
    // Delete uploaded files if there's an error
    cleanupUploadedFiles(req.files);
    res.status(400).json({ error: err.message || err });
  }
});

// (U) Update Video Gallery Event
router.post(
  "/update/:id",
  verify,
  upload.array("videos", 10),
  async (req, res) => {
    try {
      const gallery = await VideoGallery.findById(req.params.id);

      if (!gallery) {
        return res.status(404).json({ message: "Video gallery not found" });
      }

      // Update fields
      if (req.body.title !== undefined) gallery.title = req.body.title;
      if (req.body.description !== undefined)
        gallery.description = req.body.description;

      // If new videos are uploaded, replace the existing set
      if (req.files && req.files.length > 0) {
        // Delete old videos
        (gallery.videos || []).forEach(deleteVideoFile);
        // Save new video paths without "public" prefix
        gallery.videos = req.files.map((file) => `videos/${file.filename}`);
      }

      // Update YouTube video IDs if provided (replaces the existing set)
      const youtubeUrls = parseYoutubeUrls(req.body.youtube_urls);
      if (youtubeUrls !== undefined) {
        gallery.youtube_urls = youtubeUrls;
        // Refresh stored metadata, reusing provided/existing entries and
        // fetching anything new from YouTube's oEmbed endpoint
        const existingMeta =
          (gallery.youtube_meta || []).map((m) => ({
            id: m.id,
            title: m.title || "",
            author: m.author || "",
            thumbnail: m.thumbnail || "",
          }));
        const merged = [...existingMeta, ...parseYoutubeMeta(req.body.youtube_meta, youtubeUrls)];
        gallery.youtube_meta = await completeYouTubeMeta(
          youtubeUrls,
          merged
        );
      }

      // When no new videos are uploaded, support drag-and-drop reordering of
      // the existing video files via the existing_video_order field.
      const existingVideoOrder = parseOrderList(req.body.existing_video_order);
      if (
        (!req.files || req.files.length === 0) &&
        existingVideoOrder &&
        isPermutation(existingVideoOrder, gallery.videos || [])
      ) {
        gallery.videos = existingVideoOrder;
      }

      const log_id = await createLog({
        data: JSON.stringify({ ...gallery.toObject(), ...req.body }),
        user: req.user._id,
        activity: "Update",
        page: "VideoGallery",
        ip_information: req.ip,
        route: "/update",
      });

      const updatedGallery = await gallery.save();
      res.json({ gallery: updatedGallery });
    } catch (err) {
      // Delete uploaded files if there's an error
      cleanupUploadedFiles(req.files);
      res.status(400).json({ error: err.message || err });
    }
  }
);

// (U2) Reorder Video Gallery Events (admin drag-and-drop ordering)
// Body: { order: ["id1", "id2", ...] } — the full ordered list of event IDs.
router.post("/reorder", verify, async (req, res) => {
  try {
    const order = req.body.order;
    if (!Array.isArray(order) || order.length === 0) {
      return res
        .status(400)
        .json({ error: "order must be a non-empty array of video gallery IDs" });
    }

    const ids = order.map((id) => String(id).trim()).filter(Boolean);
    const galleries = await VideoGallery.find({ _id: { $in: ids } }).select(
      "_id"
    );
    const foundIds = new Set(galleries.map((g) => String(g._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: "One or more video gallery IDs do not exist", missing });
    }

    const ops = ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sort_order: index + 1 } },
      },
    }));
    await VideoGallery.bulkWrite(ops);

    const log_id = await createLog({
      data: JSON.stringify({ order: ids }),
      user: req.user._id,
      activity: "Reorder",
      page: "VideoGallery",
      ip_information: req.ip,
      route: "/reorder",
    });

    res.json({ message: "Video gallery order updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (D) Delete Video Gallery Event
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const gallery = await VideoGallery.findById(req.params.id);

    if (!gallery) {
      return res.status(404).json({ message: "Video gallery not found" });
    }

    // Delete all gallery video files
    (gallery.videos || []).forEach(deleteVideoFile);

    const log_id = await createLog({
      data: JSON.stringify(gallery.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "VideoGallery",
      ip_information: req.ip,
      route: "/delete",
    });

    await gallery.deleteOne();
    res.json({ message: "Video gallery deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting video gallery", error: err });
  }
});

module.exports = router;
