const AuditLog = require("../models/LogReport");

//Create AuditLog
const createLog = async (data) => {
  const auditLog = new AuditLog({
    log_detail: data.log_detail ? data.log_detail : null,
    data: data.data ? data.data : null,
    activity: data.activity,
    user_id: data.user,
    page: data.page,
    ip_information: data.ip_information ? data.ip_information : null,
    page_route: data.route,
  });

  try {
    const savedLogReport = await auditLog.save();
    return auditLog._id;
  } catch (err) {
    return err;
  }
};

module.exports.createLog = createLog;
