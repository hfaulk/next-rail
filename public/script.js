// Constants
const EARTH_RADIUS_KM = 6_371;
const COUNTDOWN_INTERVAL_MS = 1_000;
const DISPLAY_REFRESH_MS = 30_000; // Re-fetch departure data every 30 seconds
const GEOLOCATION_REFRESH_MS = 3_600_000; // Re-check location every 60 minutes

// Station
// Holds the CRS of the currently displayed station so the display
// refresh timer always polls the right place.
let currentCrs = null;

// Holds the display refresh timer so it can be cancelled when the
// station changes (e.g. user moves to a different station mid-hour).
let displayRefreshTimer = null;

/**
 * Updates the station name/code in the header, triggers an immediate
 * display refresh, and (re)starts the 30-second display polling loop.
 */
function setStation(crs, name) {
  document.querySelector("#stat_name").textContent = name;
  document.querySelector("#stat_code").textContent = crs;

  currentCrs = crs;

  // Immediate refresh, then repeat on a fixed interval
  updateDisplay(crs, countdown);
  clearInterval(displayRefreshTimer);
  displayRefreshTimer = setInterval(
    () => updateDisplay(currentCrs, countdown),
    DISPLAY_REFRESH_MS,
  );
}

// Geolocation
/**
 * Requests the device's current position and updates the nearest station.
 * Called automatically on load, every hour, and when the locate button is pressed.
 */
function refreshLocation() {
  if (!navigator.geolocation) {
    console.error("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async ({ coords: { latitude, longitude } }) => {
      const closest = await findNearestStation(latitude, longitude);
      setStation(closest.crs, closest.name);
    },
    (err) => console.error("Geolocation error:", err),
  );
}

// Manual override — button forces an immediate location + display refresh
document.querySelector("#locate").addEventListener("click", refreshLocation);

// Countdown
class Countdown {
  #endTime = null;
  #isLate = false;
  #confirmedLate = false; // true only when the API has returned an explicit delayed time
  #hasLoaded = false; // true after the first successful data fetch
  #hours = 0;
  #minutes = 0;
  #seconds = 0;

  #labelEl = document.querySelector("#cd_label");
  #timerEl = document.querySelector("#cd_timer");

  constructor() {
    // #endTime and #hasLoaded stay at their default values (null / false)
    // until the first real data arrives via setTime() or setLate().
  }

  setTime(timeString) {
    this.#endTime = timeString ? this.#parseTime(timeString) : null;
    this.#confirmedLate = false;
    this.#hasLoaded = true;
  }

  // Call this when the API confirms the service is delayed with a new time.
  setLate(timeString) {
    this.#endTime = this.#parseTime(timeString);
    this.#confirmedLate = true;
    this.#hasLoaded = true;
  }

  #parseTime(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  #millisecondsRemaining() {
    return this.#endTime.getTime() - Date.now();
  }

  #calculateComponents(ms) {
    this.#isLate = ms < 0;
    const absDiff = Math.abs(ms);
    this.#hours = Math.floor(absDiff / (1_000 * 60 * 60));
    this.#minutes = Math.floor((absDiff / 60_000) % 60);
    this.#seconds = Math.floor((absDiff / 1_000) % 60);
  }

  #render() {
    // Don't show anything until the first fetch has resolved
    if (!this.#hasLoaded) return;

    if (!this.#endTime) {
      this.#timerEl.textContent = "No Services";
      this.#labelEl.textContent = "";
      this.#timerEl.classList.remove("late");
      return;
    }

    const pad = (n) => String(n).padStart(2, "0");

    if (this.#isLate) {
      // Only show a counting-up red timer if the service is confirmed delayed.
      // If we haven't received a new estimated time yet, stay at 00:00:00.
      if (this.#confirmedLate) {
        this.#timerEl.textContent = `${pad(this.#hours)}:${pad(this.#minutes)}:${pad(this.#seconds)}`;
        this.#labelEl.textContent = "Late By";
        this.#timerEl.classList.add("late");
      } else {
        this.#timerEl.textContent = "00:00:00";
        this.#labelEl.textContent = "Departing Soon";
        this.#timerEl.classList.remove("late");
      }
    } else {
      this.#timerEl.textContent = `${pad(this.#hours)}:${pad(this.#minutes)}:${pad(this.#seconds)}`;
      this.#labelEl.textContent = "Departing In";
      this.#timerEl.classList.remove("late");
    }
  }

  start() {
    setInterval(() => {
      if (this.#endTime) {
        this.#calculateComponents(this.#millisecondsRemaining());
      }
      this.#render();
    }, COUNTDOWN_INTERVAL_MS);
  }
}

// Display
// Returns duration between two "HH:MM" time strings.
function getJourneyDuration(start, end) {
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += 24 * 60;

  return {
    totalMinutes: diff,
    formatted: `${Math.floor(diff / 60)}h ${diff % 60}m`,
  };
}

// Resets all fields with "-" — only called when we *know* there are no services,
// never on a loading state or network error.
function clearDisplay(countdown) {
  const fields = [
    "from",
    "to",
    "depart_time",
    "platform_num",
    "stop_num",
    "cars_num",
    "jt_time",
    "op_name",
  ];
  for (const id of fields) {
    document.querySelector(`#${id}`).textContent = "-";
  }
  countdown.setTime("");
}

// Fetches departure and service data for a station, then updates the UI.
async function updateDisplay(crs, countdown) {
  try {
    const departuresRes = await fetch(`/api/departures/${crs}`);
    const departuresData = await departuresRes.json();

    const services = departuresData.trainServices;
    if (!services?.length) {
      clearDisplay(countdown);
      return;
    }

    const firstService = services[0];
    const serviceId = firstService.serviceIdGuid;

    const serviceRes = await fetch(`/api/services/${serviceId}`);
    const serviceData = await serviceRes.json();

    const callingPoints =
      serviceData.subsequentCallingPoints?.[0]?.callingPoint;
    if (!callingPoints) {
      clearDisplay(countdown);
      return;
    }

    // Determine actual departure time (may be delayed)
    const scheduledTime = firstService.std;
    const estimatedTime = firstService.etd;
    const isDelayed = estimatedTime?.length === 5;
    const departureTime = isDelayed ? estimatedTime : scheduledTime;

    // Arrival at final calling point
    const lastStop = callingPoints.at(-1);
    const arrivalTime = lastStop.et?.length === 5 ? lastStop.et : lastStop.st;
    const duration = getJourneyDuration(departureTime, arrivalTime);

    // Update DOM
    document.querySelector("#from").textContent = firstService.origin[0].crs;
    document.querySelector("#to").textContent = firstService.destination[0].crs;
    document.querySelector("#platform_num").textContent =
      firstService.platform ?? "-";
    document.querySelector("#stop_num").textContent = callingPoints.length;
    document.querySelector("#cars_num").textContent =
      firstService.length ?? "-";
    document.querySelector("#jt_time").textContent = duration.formatted;
    document.querySelector("#op_name").textContent = firstService.operator;

    const departEl = document.querySelector("#depart_time");
    departEl.textContent = departureTime;
    departEl.classList.toggle("late", isDelayed);

    if (isDelayed) {
      countdown.setLate(departureTime);
    } else {
      countdown.setTime(departureTime ?? "");
    }

    // Populate upcoming departures
    const nextSlots = ["#next_1", "#next_2", "#next_3"];
    nextSlots.forEach((selector, i) => {
      const slot = document.querySelector(selector);
      const service = services[i + 1];
      if (service) {
        slot.children[0].textContent = service.destination[0].locationName;
        slot.children[1].textContent = service.std;
      } else {
        slot.children[0].textContent = "-";
        slot.children[1].textContent = "-";
      }
    });
  } catch (err) {
    // Network/parse error — leave the existing display intact rather than
    // flashing "No Services" during a transient failure.
    console.error("Failed to update display:", err);
  }
}

// Station Finder
// Converts degs to rads
const toRadians = (deg) => (Math.PI / 180) * deg;

// Gives distance (km) between two coord sets
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * EARTH_RADIUS_KM;
}

// Finding nearest station to given coords
async function findNearestStation(lat, lon) {
  const res = await fetch("/api/stations");
  const stations = await res.json();

  return stations.reduce(
    (closest, station) => {
      const dist = haversine(lat, lon, station.latitude, station.longitude);
      return dist < closest.dist
        ? { crs: station["3alpha"], name: station.station_name, dist }
        : closest;
    },
    { dist: Infinity, crs: null, name: null },
  );
}

// Initialise
const countdown = new Countdown();
countdown.start();

// Fetch location immediately on page load, then re-check every hour.
// Each call to refreshLocation → setStation → updateDisplay also
// restarts the 30-second display polling loop.
refreshLocation();
setInterval(refreshLocation, GEOLOCATION_REFRESH_MS);
