//Validation
const Joi = require("joi");

// Define a custom validation function for the password
const validatePassword1 = (password, helpers) => {
  // Check if the password meets the complexity requirements
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecialChar) {
    return helpers.error("password_complexity");
  }

  // Check if the password is not a commonly used password
  const blacklist = [
    "password",
    "123456",
    "qwerty",
    "123456789",
    "12345",
    "qwerty123",
    "1q2w3e",
    "12345678",
    "1234567890",
    "111111",
  ];
  if (blacklist.includes(password.toLowerCase())) {
    return helpers.error("password blacklist");
  }

  return password;
};

const validatePassword = (password, helpers) => {
  // Check if the password meets the complexity requirements
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecialChar) {
    return helpers.error("password_complexity");
  }

  // Check if the password is not a commonly used password
  const blacklist = [
    "password",
    "123456",
    "qwerty",
    "123456789",
    "12345",
    "qwerty123",
    "1q2w3e",
    "12345678",
    "1234567890",
    "111111",
  ];
  if (blacklist.includes(password.toLowerCase())) {
    return helpers.error("password_blacklist");
  }

  return password;
};

//Register Validation
const registerValidation = (data) => {
  const schema = Joi.object({
    first_name: Joi.string()
      .required()
      .pattern(new RegExp("^[a-zA-Z- ]{3,30}$")),
    last_name: Joi.string()
      .allow(null, "")
      .default("")
      .optional()
      .max(30)
      // .pattern(new RegExp("^[a-zA-Z- ]{2,30}$"))
      .required(false),
    mobile: Joi.string().max(20).allow(null, "").default("").optional(),
    email: Joi.string()
      .email({
        minDomainSegments: 2,
        tlds: { allow: ["com", "net", "in"] },
      })
      .required(),
    password: Joi.string()
      .min(6)
      .custom(validatePassword, "password_validation")
      .messages({
        "string.min": "Password must be at least {{#limit}} characters long",
        "password_validation.password_complexity":
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
        "password_validation.password blacklist":
          "Password is too common and not allowed",
      }),
    role: Joi.string().required().pattern(new RegExp("^[a-zA-Z-_]{3,30}$")),
    user_type: Joi.string()
      .allow()
      .pattern(new RegExp("^[a-zA-Z-  ()]{3,30}$")),
    // employee_id: Joi.string().allow(),
    // createdBy: Joi.string().allow(),
  });

  return schema.validate(data);
};

//User Update Validation
const updateValidation = (data) => {
  const schema = Joi.object({
    first_name: Joi.string()
      .required()
      .regex(/^[a-zA-Z0-9- ]*$/),
    last_name: Joi.string()
      .allow(null, "")
      .default("")
      .optional()
      .regex(/^[a-zA-Z0-9- ]*$/),
    mobile: Joi.string()
      .max(20)
      .allow(null, "")
      .default("")
      .optional()
      .regex(/^[a-zA-Z0-9- ]*$/),
    email: Joi.string()
      .email({
        minDomainSegments: 2,
        tlds: { allow: ["com", "net", "in"] },
      })
      .required(),
    password: Joi.string()
      .min(6)
      .custom(validatePassword, "password_validation")
      .messages({
        "string.min": "Password must be at least {{#limit}} characters long",
        "password_validation.password_complexity":
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
        "password_validation.password_blacklist":
          "Password is too common and not allowed",
        "any.required": "Password is required",
      })
      .allow(null, "")
      .optional(),
    role: Joi.string().required().pattern(new RegExp("^[a-zA-Z-_]{3,30}$")),
    user_type: Joi.string()
      .pattern(new RegExp("^[a-zA-Z-  ()]{3,30}$"))
      .allow(),
    employee_id: Joi.string().allow(),
  });
  return schema.validate(data);
};

//Login Validation
const loginValidation = (data) => {
  const schema = Joi.object({
    email: Joi.string().email({
      minDomainSegments: 2,
      tlds: { allow: ["com", "net", "in"] },
    }),
    password: Joi.string()
      .min(6)
      .pattern(new RegExp("^[a-zA-Z0-9-@#$!%^&*?]{3,30}$")),
  });

  return schema.validate(data);
};

//Supplier Validation
const supplierValidation = (data) => {
  const schema = Joi.object({
    supplier_name: Joi.string()
      .required()
      .regex(/^[a-zA-Z0-9- ]*$/),
    company_name: Joi.string()
      .required()
      .regex(/^[a-zA-Z0-9- ]*$/),
    // address: Joi.string()
    //   .required()
    //   .regex(/^[a-zA-Z0-9- ]*$/),
    // products: Joi.string()
    //   .required()
    //   .regex(/^[a-zA-Z0-9-/, ]*$/),
    comments: Joi.string()
      .regex(/^[a-zA-Z0-9-/. ]*$/)
      .allow("")
      .allow(null),
    website: Joi.string()
      .regex(/^[a-zA-Z0-9-/.:]*$/)
      .allow("")
      .allow(null),
    phone: Joi.string()
      .required()
      .regex(/^[0-9+/ ]*$/),
  });

  return schema.validate(data);
};

//Product Validation
const productValidation = (data) => {
  const schema = Joi.object({
    product_name: Joi.string()
      .required()
      .regex(/^[a-zA-Z0-9- ]*$/),
    measuring_unit: Joi.string()
      .required()
      .pattern(new RegExp("^[a-zA-Z-/ ]{1,30}$")),
    storage_unit: Joi.string()
      .required()
      .pattern(new RegExp("^[a-zA-Z-/)( ]{1,30}$")),
    company_name: Joi.string().alphanum(),
    contact_number: Joi.string()
      .regex(/^[0-9+/ ]*$/)
      .optional()
      .allow("")
      .allow(null),
    comments: Joi.string()
      .regex(/^[a-zA-Z]*$/)
      .optional()
      .allow("")
      .allow(null),
  });
  return schema.validate(data);
};

//Purchase Validation
const purchaseRequestValidation = (data) => {
  const schema = Joi.object({
    requested_quantity: Joi.string()
      .required()
      .pattern(new RegExp("^[0-9]{1,30}$")),
    comments: Joi.string().pattern(new RegExp("^[a-zA-Z- /]{3,30}$")),
  });
  return schema.validate(data);
};

//Patient Validation
const patientValidation = (data) => {
  const schema = Joi.object({
    patient_name: Joi.string()
      .required()
      .regex(/^[a-zA-Z0-9-/  ]*$/),
    fathers_name: Joi.string()
      .allow(null, "")
      .default("")
      .optional()
      .regex(/^[a-zA-Z0-9- ]*$/),
    mothers_name: Joi.string()
      .allow(null, "")
      .default("")
      .optional()
      .regex(/^[a-zA-Z0-9- ]*$/),
    diagnosis_others: Joi.string()
      .allow(null, "")
      .default("")
      .optional()
      .regex(/^[a-zA-Z0-9- ]*$/),
    local_registration_id: Joi.string()
      .allow("")
      .allow(null)
      .regex(/^[a-zA-Z0-9-\- ]*$/),
  });
  return schema.validate(data);
};

module.exports.registerValidation = registerValidation;
module.exports.loginValidation = loginValidation;
module.exports.updateValidation = updateValidation;
module.exports.supplierValidation = supplierValidation;
module.exports.productValidation = productValidation;
module.exports.patientValidation = patientValidation;
module.exports.purchaseRequestValidation = purchaseRequestValidation;
