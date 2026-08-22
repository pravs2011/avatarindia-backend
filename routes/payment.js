const Razorpay = require("razorpay");
const crypto = require("crypto");

// Razorpay credentials come from the environment; resolved at call time so
// the module can be required before dotenv.config() runs.
const razorpayInstance = () =>
  new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_xxxxxxxx",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "",
  });

// Membership fee in paise. The server is the source of truth for the amount
// charged - never trust a client-supplied price.
const MEMBERSHIP_AMOUNT_PAISE = 500000; // ₹5,000

const membershipAmountInr = () => MEMBERSHIP_AMOUNT_PAISE / 100;

async function createOrder({ amountPaise, receipt }) {
  return razorpayInstance().orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes: { source: "membership-registration" },
  });
}

async function refundPayment(paymentId, amountPaise) {
  if (!paymentId) throw new Error("A Razorpay payment ID is required for refund.");
  const options = amountPaise ? { amount: amountPaise } : {};
  return razorpayInstance().payments.refund(paymentId, options);
}

// Verify the signature Razorpay returns in the browser callback
// (order_id|payment_id signed with the key secret).
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(body)
    .digest("hex");
  return expected === signature;
}

// Verify the x-razorpay-signature header on webhook requests. `rawBody` must
// be the exact raw request body (Buffer) - JSON re-serialization changes the
// payload and breaks the HMAC.
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "")
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}

module.exports = {
  createOrder,
  refundPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
  membershipAmountInr,
  MEMBERSHIP_AMOUNT_PAISE,
};
