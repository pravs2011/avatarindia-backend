const decodeTextbase64 = (password) => {
  //Private key to decode password
  const private_key = "XkhZG4fW2t2WZG4fWZG4fW2t2W";
  const decodedPasswordWithKey = Buffer.from(password, "base64").toString();
  const decodedPassword = decodedPasswordWithKey.split("-")[0];
  if (decodedPasswordWithKey.split("-")[1] !== private_key) {
    console.log("Invalid custom key");
    return res.status(400).json({ error: "Internal Error Kindly Retry" });
  }
  return decodedPassword;
};

module.exports.decodeTextbase64 = decodeTextbase64;
