const router = require("express").Router();
const EmailTemplate = require("../models/EmailTemplate");
const verify = require("./verifyToken");

// Default templates. These are the exact bodies used before customization;
// placeholders ({{name}}) are replaced with real values at send time.
const TEMPLATE_DEFAULTS = {
  otp: {
    subject: "AVATAR India Membership OTP",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>AVATAR India Membership Login</h2>
        <p>Your OTP for member login is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #B8860B;">{{otp}}</p>
        <p>This code expires in 5 minutes.</p>
      </div>
    `,
    placeholders: ["otp"],
    description:
      "One-time password email sent to a member when they request an OTP to log in.",
  },
  consent_reminder: {
    subject: "AVATAR India Membership - Consent Required",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>AVATAR India Society</h2>
        <h3 style="color: #B8860B;">Your consent is required</h3>
        <p>Dear {{memberName}},</p>
        <p>As part of your AVATAR India membership, we need your explicit consent to collect and process your personal data, as required under the <strong>Digital Personal Data Protection (DPDP) Act, 2023</strong>.</p>
        <p>We have not yet received your consent. Please log in to the member portal using the link below, review the privacy notice, and give your consent:</p>
        <p style="text-align: center;">
          <a href="{{loginUrl}}" style="display: inline-block; background-color: #B8860B; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Login &amp; Give Consent</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">(You will receive a one-time password (OTP) on your registered email address to log in.)</p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all;"><a href="{{loginUrl}}">{{loginUrl}}</a></p>
        {{grievanceContactLine}}
        <p>Regards,<br/>AVATAR India Society</p>
      </div>
    `,
    placeholders: ["memberName", "loginUrl", "grievanceContactLine"],
    description:
      "Sent when an admin emails members whose consent is pending, sharing the public link to log in and give consent.",
  },
  consent_revoked: {
    subject: "AVATAR India Membership - Consent Revoked",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>AVATAR India Society</h2>
        <h3 style="color: #B8860B;">Your consent has been revoked</h3>
        <p>Dear {{memberName}},</p>
        <p>This email confirms that your consent for the processing of your personal data for your AVATAR India membership was <strong>revoked</strong> on <strong>{{date}}</strong>.</p>
        <p>As a result, we will stop processing your personal data for the purposes covered by that consent.</p>
        <p>You can review or change your consent preferences at any time by logging into the AVATAR India member portal.</p>
        <p>If you believe this action was taken in error, please contact the AVATAR India Society administration.</p>
        <p>Regards,<br/>AVATAR India Society</p>
      </div>
    `,
    placeholders: ["memberName", "date"],
    description:
      "Sent to a member when an administrator revokes their consent.",
  },
  consent_deleted: {
    subject: "AVATAR India Membership - Consent Record Deleted",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>AVATAR India Society</h2>
        <h3 style="color: #B8860B;">Your consent record has been deleted</h3>
        <p>Dear {{memberName}},</p>
        <p>This email confirms that your consent record for your AVATAR India membership was <strong>deleted (erased)</strong> on <strong>{{date}}</strong>, in line with data-protection requirements.</p>
        <p>You can review or change your consent preferences at any time by logging into the AVATAR India member portal.</p>
        <p>If you believe this action was taken in error, please contact the AVATAR India Society administration.</p>
        <p>Regards,<br/>AVATAR India Society</p>
      </div>
    `,
    placeholders: ["memberName", "date"],
    description:
      "Sent to a member when an administrator erases their consent record (right to erasure).",
  },
};

// Short in-memory cache so we don't hit the DB on every email (OTPs send often)
let templateCache = { data: null, at: 0 };
const CACHE_TTL_MS = 60 * 1000;

const loadTemplates = async () => {
  if (templateCache.data && Date.now() - templateCache.at < CACHE_TTL_MS) {
    return templateCache.data;
  }

  const docs = await EmailTemplate.find().lean();
  const map = {};
  for (const doc of docs) {
    map[doc.template_key] = { subject: doc.subject, html: doc.html };
  }

  // Merge with defaults so unknown keys always have content
  const merged = {};
  for (const key of Object.keys(TEMPLATE_DEFAULTS)) {
    merged[key] = map[key] || TEMPLATE_DEFAULTS[key];
  }

  templateCache = { data: merged, at: Date.now() };
  return merged;
};

// Resolve a template's subject + html (DB override or default).
// Placeholders are left intact so renderTemplate can fill them later.
const getTemplate = async (key) => {
  const all = await loadTemplates();
  return all[key] || TEMPLATE_DEFAULTS[key] || null;
};

// Replace {{placeholder}} tokens with real values. Unknown tokens are kept
// as-is so a typo is visible in the sent email instead of silently dropped.
const renderTemplate = async (key, vars = {}) => {
  const tpl = await getTemplate(key);
  if (!tpl) {
    return { subject: "", html: "" };
  }
  const html = tpl.html.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    vars[name] !== undefined && vars[name] !== null
      ? String(vars[name])
      : match,
  );
  return { subject: tpl.subject, html };
};

// GET /api/email-templates — list all templates (seeding defaults on first run)
router.get("/", verify, async (req, res) => {
  try {
    const docs = await EmailTemplate.find().sort({ template_key: 1 }).lean();
    const byKey = {};
    for (const doc of docs) {
      byKey[doc.template_key] = doc;
    }

    const templates = Object.keys(TEMPLATE_DEFAULTS).map((key) => ({
      template_key: key,
      subject: byKey[key]?.subject || TEMPLATE_DEFAULTS[key].subject,
      html: byKey[key]?.html || TEMPLATE_DEFAULTS[key].html,
      placeholders: TEMPLATE_DEFAULTS[key].placeholders,
      description: TEMPLATE_DEFAULTS[key].description,
      updatedAt: byKey[key]?.updatedAt || null,
      isCustomized: Boolean(byKey[key]),
    }));

    return res.json({ success: true, templates });
  } catch (error) {
    console.error("Email templates list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load email templates.",
    });
  }
});

// PUT /api/email-templates/:key — save a customized template
router.put("/:key", verify, async (req, res) => {
  const key = String(req.params.key || "").trim().toLowerCase();
  if (!TEMPLATE_DEFAULTS[key]) {
    return res.status(404).json({
      success: false,
      message: "Unknown email template.",
    });
  }

  const subject = String(req.body.subject || "").trim();
  const html = String(req.body.html || "").trim();
  if (!subject || !html) {
    return res.status(400).json({
      success: false,
      message: "Both subject and email body are required.",
    });
  }

  try {
    await EmailTemplate.findOneAndUpdate(
      { template_key: key },
      { subject, html, updated_by: req.user._id },
      { new: true, upsert: true },
    );
    // Invalidate the cache so the next email uses the new template
    templateCache = { data: null, at: 0 };

    return res.json({
      success: true,
      message: "Email template saved successfully.",
    });
  } catch (error) {
    console.error("Email template save error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save email template.",
    });
  }
});

// POST /api/email-templates/:key/reset — restore the default template
router.post("/:key/reset", verify, async (req, res) => {
  const key = String(req.params.key || "").trim().toLowerCase();
  if (!TEMPLATE_DEFAULTS[key]) {
    return res.status(404).json({
      success: false,
      message: "Unknown email template.",
    });
  }

  try {
    await EmailTemplate.deleteOne({ template_key: key });
    templateCache = { data: null, at: 0 };

    return res.json({
      success: true,
      message: "Email template reset to default.",
    });
  } catch (error) {
    console.error("Email template reset error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to reset email template.",
    });
  }
});

module.exports = router;
module.exports.TEMPLATE_DEFAULTS = TEMPLATE_DEFAULTS;
module.exports.renderTemplate = renderTemplate;
