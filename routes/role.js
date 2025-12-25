const router = require("express").Router();
const Role = require("../models/Roles");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");

//(R) Read / Get All Roles
router.get("/", verify, async (req, res) => {
  try {
    const roles = await Role.find().sort({
      createdAt: -1,
    });
    res.json({
      roles: roles,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//(C) Create / Add a Role
router.post("/add", verify, async (req, res) => {
  // Check if role with same name already exists (case insensitive)
  const existingRole = await Role.findOne({
    role_name: {
      $regex: new RegExp(`^${req.body.role_name.replace(/\s+/g, "")}$`, "i"),
    },
  });

  if (existingRole) {
    return res
      .status(400)
      .json({ error: "Role with this name already exists" });
  }

  const role = new Role({
    role_name: req.body.role_name,
    access_level: req.body.access_level,
  });

  const log_id = await createLog({
    data: JSON.stringify({ ...req.body }),
    user: req.user._id,
    activity: "Create",
    page: "Role",
    ip_information: req.ip,
    route: "/add",
  });

  try {
    const savedRole = await role.save();
    res.send({ role: role._id });
  } catch (err) {
    res.status(400).send(err);
  }
});

//(D) Delete Roles
router.delete("/delete/:id", verify, async (req, res) => {
  //Check if Patient _id exists
  const roleExist = await Role.findById(req.params.id);

  if (!roleExist)
    return res.status(400).send({ message: "Record Doesn't Exists" });

  const log_id = await createLog({
    data: JSON.stringify({ roleExist }),
    user: req.user._id,
    activity: "Delete",
    page: "Role",
    ip_information: req.ip,
    route: "/delete",
  });

  try {
    await roleExist.remove();
    res.json({ message: "Deleted Record sucessfully" });
  } catch (err) {
    res.status(500).send({ message: "Record Doesn't Exists", error: err });
  }
});

module.exports = router;
