const ItemCode = require("../models/ItemCode");
//const { createLog } = require("./logreport");

const generateItemCode = async (item_name, item_prefix, start_code) => {
  let startCode = parseInt(start_code);
  if (!startCode) {
    startCode = 11001010;
  }

  // Specify the search criteria
  const query = {
    $and: [{ item_name: item_name }, { item_prefix: item_prefix }],
  };

  // Find the document that matches the search criteria and has the latest insertion time
  const itemCodeExist = await ItemCode.findOne(query).sort({
    createdAt: -1,
  });

  if (!itemCodeExist) {
    const NewitemCode = new ItemCode({
      item_name: item_name,
      item_prefix: item_prefix,
      item_code: parseInt(startCode),
    });
    try {
      const savedItemCode = await NewitemCode.save();
      return `${NewitemCode.item_prefix}-${NewitemCode.item_code}`;
    } catch (error) {
      console.log(error);
    }
  } else {
    const NewitemCode = new ItemCode({
      item_name: itemCodeExist?.item_name,
      item_prefix: itemCodeExist?.item_prefix,
      item_code: parseInt(itemCodeExist?.item_code) + 1,
    });

    try {
      const savedItemCode = await NewitemCode.save();
      return `${NewitemCode.item_prefix}-${NewitemCode.item_code}`;
    } catch (error) {
      console.log(error);
    }
  }
};

module.exports.generateItemCode = generateItemCode;
