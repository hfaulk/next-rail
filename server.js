import express from "express";
import "dotenv/config";
import stations from "./data/uk-train-stations.json" with { type: "json" };

const app = express();
const TOKEN = process.env.HUXLEY_TOKEN;
const HUXLEY = "https://huxley2.azurewebsites.net";

app.use(express.static("public"));

app.listen(3000, () => console.log("Running on http://localhost:3000"));

// Page Routes
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public/html" });
});

app.get("/graph", (req, res) => {
  res.sendFile("graph.html", { root: "public/html" });
});


// API Routes
app.get("/api/departures/:station", async (req, res) => {
  try {
    const url =
      HUXLEY + "/departures/" + req.params.station + "/10?accessToken=" + TOKEN;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch departures" });
  }
});

app.get("/api/departures-expand/:station", async (req, res) => {
  try{
    const url = HUXLEY + "/departures/" + req.params.station + "/10?expand=true&timeWindow=120&accessToken=" + TOKEN;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch departures" });
  }
});

app.get("/api/services/:serviceId", async (req, res) => {
  try {
    const url =
      HUXLEY + "/service/" + req.params.serviceId + "?accessToken=" + TOKEN;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch service" });
  }
});

app.get("/api/stations", (req, res) => {
  res.json(stations);
});
