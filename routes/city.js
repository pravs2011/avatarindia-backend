const router = require("express").Router();
const verify = require("./verifyToken");
const citiesData = require("./data/cities.json"); // Large dataset

router.get("/:id", verify, (req, res) => {
  const stateId = req.params.id;

  try {
    const filteredCities = citiesData.filter(
      (city) => city.state_id === parseInt(stateId)
    );
    res.status(200).json({ cities: filteredCities });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

module.exports = router;
