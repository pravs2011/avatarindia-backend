const { Router } = require("express");
const Registration = require("../models/Registration");
const PendingRegistration = require("../models/PendingRegistration");
const { createNotification } = require("./notifications");
const { verifyWebhookSignature } = require("./payment");
const {
  getNextSNo,
  makeRegNo,
  sendWelcomeMemberEmail,
} = require("./registration");

const router = Router();

// Create the member record from a pending registration (payment captured).
// Shared by the webhook and used when a browser callback is missed. Returns
// the created member or null if already created (idempotent).
async function createMemberFromPending(pending, paymentId, signature) {
  const existing = await Registration.findOne({
    paymentOrderId: pending.orderId,
  });
  if (existing) return existing;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0];

  let member = null;
  let attempts = 0;
  while (!member && attempts < 5) {
    const sNo = await getNextSNo();
    const registrationNo = makeRegNo(sNo);

    try {
      const newMember = new Registration({
        sNo,
        registrationNo,
        mobileNo: pending.mobileNo,
        email: pending.email,
        title: pending.title,
        firstName: pending.firstName,
        lastName: pending.lastName,
        fullName: pending.fullName,
        country: pending.country || "India",
        speciality: pending.speciality || "",
        hospitalName: pending.hospitalName || "",
        designation: pending.designation || "",
        membershipPlan: pending.membershipPlan || "Lifetime",
        amount: pending.amount || 5000,
        paymentOrderId: pending.orderId,
        paymentId: paymentId || "",
        paymentSignature: signature || "",
        paymentStatus: "paid",
        paidAt: now,
        expiryDate: "LifeTime",
        date: dateStr,
        time: timeStr,
        registeredAt: now,
        consent: true,
        consentGivenAt: new Date(),
        consentRevokedAt: null,
        consentDeletedAt: null,
        consentExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
      member = await newMember.save();
    } catch (saveErr) {
      if (saveErr.code === 11000 && attempts < 4) {
        attempts++;
        continue;
      }
      throw saveErr;
    }
  }

  await createNotification({
    type: "REGISTRATION",
    message: `New membership registration: ${member.fullName} (${member.registrationNo})`,
    registrationNo: member.registrationNo,
    memberName: member.fullName,
    memberEmail: member.email,
  });

  try {
    await sendWelcomeMemberEmail(member);
  } catch (err) {
    console.error("Webhook welcome email error:", err.message);
  }

  return member;
}

// Razorpay payment webhook. Mounted with express.raw() in server.js / index.js
// so req.body is the exact raw Buffer required for signature verification.
// Always acknowledges with 200 once processed (Razorpay retries non-2xx).
router.post("/", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.body; // Buffer

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("Razorpay webhook: invalid signature");
    return res.status(400).json({ success: false, error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.warn("Razorpay webhook: unparseable body", err.message);
    return res.status(400).json({ success: false, error: "Invalid body" });
  }

  try {
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id || "";

      const pending = await PendingRegistration.findOne({ orderId });
      if (pending) {
        const member = await createMemberFromPending(
          pending,
          payment.id,
          payment.signature,
        );
        if (member) {
          console.log(
            `Razorpay webhook: created member ${member.registrationNo} for order ${orderId}`,
          );
          await PendingRegistration.deleteOne({ _id: pending._id });
        }
      } else {
        // No pending record for this order (webhook raced ahead of
        // create-order, or already settled). Nothing to reconcile.
        console.warn(
          "Razorpay webhook: no pending registration found for order",
          orderId,
        );
      }
    } else if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id || "";
      // Payment failed - discard the pending registration so no member is
      // ever created for it.
      const deleted = await PendingRegistration.deleteOne({ orderId });
      if (deleted.deletedCount > 0) {
        console.log(
          `Razorpay webhook: discarded pending registration for failed order ${orderId}`,
        );
      }
    }
  } catch (error) {
    console.error("Razorpay webhook handler error:", error.message);
    // Still acknowledge so Razorpay stops retrying; the payment is captured
    // and can be reconciled manually from the dashboard.
  }

  res.status(200).json({ received: true });
});

module.exports = router;
module.exports.router = router;
module.exports.createMemberFromPending = createMemberFromPending;
