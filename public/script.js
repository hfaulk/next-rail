// Constants
const EARTH_RADIUS_KM = 6_371;
const COUNTDOWN_INTERVAL_MS = 1_000;
const DISPLAY_REFRESH_MS = 30_000; // Re-fetch departure data every 30 seconds
const GEOLOCATION_REFRESH_MS = 3_600_000; // Re-check location every 60 minutes
const CANCELLATION_LINGER_MS = 6_000; // How long to show "Cancelled" before moving on

// Station
let currentCrs = null;
let displayRefreshTimer = null;
let currentServiceId = null; // serviceIdGuid of the service currently on the main display
let cancellationLingerTimer = null; // prevents a new refresh overriding the cancelled notice too soon

function setStation(crs, name) {
  document.querySelector("#stat_name").textContent = name;
  document.querySelector("#stat_code").textContent = crs;

  currentCrs = crs;

  updateDisplay(crs, countdown);
  clearInterval(displayRefreshTimer);
  displayRefreshTimer = setInterval(
    () => updateDisplay(currentCrs, countdown),
    DISPLAY_REFRESH_MS,
  );
}

// Geolocation
function refreshLocation() {
  if (!navigator.geolocation) {
    showStationSearch();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async ({ coords: { latitude, longitude } }) => {
      const closest = await findNearestStation(latitude, longitude);
      setStation(closest.crs, closest.name);
    },
    (err) => {
      console.warn("Geolocation denied or unavailable:", err.message);
      showStationSearch();
    },
  );
}

document.querySelector("#locate").addEventListener("click", refreshLocation);

// Station search (fallback when geolocation is denied)
let allStations = null; // cached after first load

async function loadStations() {
  if (allStations) return allStations;
  const res = await fetch("/api/stations");
  allStations = await res.json();
  return allStations;
}

function showStationSearch() {
  document.querySelector("#locate").hidden = true;
  document.querySelector("#station_search").hidden = false;
  document.querySelector("#search_input").focus();
}

// Preload stations list in the background so search feels instant
loadStations();

const searchInput = document.querySelector("#search_input");
const searchResults = document.querySelector("#search_results");
let highlightedIndex = -1;

searchInput.addEventListener("input", async () => {
  const query = searchInput.value.trim().toLowerCase();
  highlightedIndex = -1;

  if (query.length < 2) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }

  const stations = await loadStations();

  // Match on name or CRS code, name matches ranked first
  const matches = stations
    .filter(
      (s) =>
        s.station_name.toLowerCase().includes(query) ||
        s["3alpha"].toLowerCase().includes(query),
    )
    .sort((a, b) => {
      const aName = a.station_name.toLowerCase().startsWith(query) ? 0 : 1;
      const bName = b.station_name.toLowerCase().startsWith(query) ? 0 : 1;
      return aName - bName;
    })
    .slice(0, 8);

  if (!matches.length) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }

  searchResults.innerHTML = matches
    .map(
      (s, i) => `
      <li data-crs="${s["3alpha"]}" data-name="${s.station_name}">
        <span>${s.station_name}</span>
        <span class="result-crs">${s["3alpha"]}</span>
      </li>
    `,
    )
    .join("");

  searchResults.hidden = false;
});

searchResults.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  selectStation(li.dataset.crs, li.dataset.name);
});

// Keyboard navigation
searchInput.addEventListener("keydown", (e) => {
  const items = [...searchResults.querySelectorAll("li")];
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
    updateHighlight(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex = Math.max(highlightedIndex - 1, 0);
    updateHighlight(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const target = highlightedIndex >= 0 ? items[highlightedIndex] : items[0];
    if (target) selectStation(target.dataset.crs, target.dataset.name);
  } else if (e.key === "Escape") {
    searchResults.hidden = true;
    highlightedIndex = -1;
  }
});

function updateHighlight(items) {
  items.forEach((li, i) =>
    li.classList.toggle("highlighted", i === highlightedIndex),
  );
  items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
}

function selectStation(crs, name) {
  searchInput.value = name;
  searchResults.hidden = true;
  searchResults.innerHTML = "";
  highlightedIndex = -1;
  setStation(crs, name);
}

// Close results if clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest("#station_search")) {
    searchResults.hidden = true;
    highlightedIndex = -1;
  }
});

// Countdown
class Countdown {
  #endTime = null;
  #isLate = false;
  #confirmedLate = false;
  #isCancelled = false;
  #hasLoaded = false;
  #hours = 0;
  #minutes = 0;
  #seconds = 0;

  #labelEl = document.querySelector("#cd_label");
  #timerEl = document.querySelector("#cd_timer");

  constructor() {}

  setTime(timeString) {
    this.#endTime = timeString ? this.#parseTime(timeString) : null;
    this.#confirmedLate = false;
    this.#isCancelled = false;
    this.#hasLoaded = true;
  }

  setLate(timeString) {
    this.#endTime = this.#parseTime(timeString);
    this.#confirmedLate = true;
    this.#isCancelled = false;
    this.#hasLoaded = true;
  }

  setCancelled() {
    this.#endTime = null;
    this.#isCancelled = true;
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
    if (!this.#hasLoaded) return;

    if (this.#isCancelled) {
      this.#timerEl.textContent = "Cancelled";
      this.#labelEl.textContent = "This Service Has Been";
      this.#timerEl.classList.add("cancelled-timer");
      this.#timerEl.classList.remove("late");
      return;
    }

    this.#timerEl.classList.remove("cancelled-timer");

    if (!this.#endTime) {
      this.#timerEl.textContent = "No Services";
      this.#labelEl.textContent = "";
      this.#timerEl.classList.remove("late");
      return;
    }

    const pad = (n) => String(n).padStart(2, "0");

    if (this.#isLate) {
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
      if (this.#endTime && !this.#isCancelled) {
        this.#calculateComponents(this.#millisecondsRemaining());
      }
      this.#render();
    }, COUNTDOWN_INTERVAL_MS);
  }
}

// Display
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

async function updateDisplay(crs, countdown) {
  // If we're in the middle of showing a cancellation notice, don't override it
  if (cancellationLingerTimer) return;

  try {
    const departuresRes = await fetch(`/api/departures/${crs}`);
    const departuresData = await departuresRes.json();

    const services = departuresData.trainServices;
    if (!services?.length) {
      clearDisplay(countdown);
      return;
    }

    // Check if the service we're currently displaying has become cancelled
    if (currentServiceId) {
      const currentInList = services.find(
        (s) => s.serviceIdGuid === currentServiceId,
      );
      if (currentInList?.isCancelled) {
        // Show cancellation notice and hold it for CANCELLATION_LINGER_MS before
        // refreshing to the next service
        const cancelReasonEl = document.querySelector("#cancel_reason");
        cancelReasonEl.textContent =
          currentInList.cancelReason ?? "This service has been cancelled.";
        cancelReasonEl.hidden = false;
        countdown.setCancelled();

        cancellationLingerTimer = setTimeout(() => {
          cancellationLingerTimer = null;
          cancelReasonEl.hidden = true;
          cancelReasonEl.textContent = "";
          currentServiceId = null;
          updateDisplay(crs, countdown);
        }, CANCELLATION_LINGER_MS);
        return;
      }
    }

    // Find the first non-cancelled service for the main display
    const firstService = services.find((s) => !s.isCancelled);
    if (!firstService) {
      clearDisplay(countdown);
      return;
    }

    const serviceRes = await fetch(
      `/api/services/${firstService.serviceIdGuid}`,
    );
    const serviceData = await serviceRes.json();

    const callingPoints =
      serviceData.subsequentCallingPoints?.[0]?.callingPoint;
    if (!callingPoints) {
      clearDisplay(countdown);
      return;
    }

    // Guard: service detail says cancelled (updated between the two fetches)
    if (serviceData.isCancelled) {
      const cancelReasonEl = document.querySelector("#cancel_reason");
      cancelReasonEl.textContent =
        serviceData.cancelReason ?? "This service has been cancelled.";
      cancelReasonEl.hidden = false;
      countdown.setCancelled();

      cancellationLingerTimer = setTimeout(() => {
        cancellationLingerTimer = null;
        cancelReasonEl.hidden = true;
        cancelReasonEl.textContent = "";
        currentServiceId = null;
        updateDisplay(crs, countdown);
      }, CANCELLATION_LINGER_MS);
      return;
    }

    // Normal update
    currentServiceId = firstService.serviceIdGuid;

    const scheduledTime = firstService.std;
    const estimatedTime = firstService.etd;
    const isDelayed = estimatedTime?.length === 5;
    const departureTime = isDelayed ? estimatedTime : scheduledTime;

    const lastStop = callingPoints.at(-1);
    const arrivalTime = lastStop.et?.length === 5 ? lastStop.et : lastStop.st;
    const duration = getJourneyDuration(departureTime, arrivalTime);

    document.querySelector("#from").textContent = firstService.origin[0].crs;
    document.querySelector("#to").textContent = firstService.destination[0].crs;
    document.querySelector("#platform_num").textContent =
      firstService.platform ?? "-";
    document.querySelector("#stop_num").textContent = callingPoints.length;
    document.querySelector("#cars_num").textContent =
      firstService.length || "-";
    document.querySelector("#jt_time").textContent = duration.formatted;
    document.querySelector("#op_name").textContent = firstService.operator;

    const departEl = document.querySelector("#depart_time");
    departEl.textContent = departureTime;
    departEl.classList.toggle("late", isDelayed);

    const cancelReasonEl = document.querySelector("#cancel_reason");
    cancelReasonEl.hidden = true;
    cancelReasonEl.textContent = "";

    if (isDelayed) {
      countdown.setLate(departureTime);
    } else {
      countdown.setTime(departureTime ?? "");
    }

    // Upcoming departures — show all services (including cancelled), skipping
    // the one already shown as the main service.
    const upcoming = services.filter((s) => s !== firstService).slice(0, 3);
    const nextSlots = ["#next_1", "#next_2", "#next_3"];
    nextSlots.forEach((selector, i) => {
      const slot = document.querySelector(selector);
      const service = upcoming[i];
      if (service) {
        const isCancelled = service.isCancelled;
        slot.children[0].textContent = service.destination[0].locationName;
        slot.children[1].textContent = isCancelled ? "Cancelled" : service.std;
        slot.children[0].classList.toggle("cancelled", isCancelled);
        slot.children[1].classList.toggle("cancelled", isCancelled);
      } else {
        slot.children[0].textContent = "-";
        slot.children[1].textContent = "-";
        slot.children[0].classList.remove("cancelled");
        slot.children[1].classList.remove("cancelled");
      }
    });
  } catch (err) {
    console.error("Failed to update display:", err);
  }
}

// Station Finder
const toRadians = (deg) => (Math.PI / 180) * deg;

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

async function findNearestStation(lat, lon) {
  const stations = await loadStations();

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

refreshLocation();
setInterval(refreshLocation, GEOLOCATION_REFRESH_MS);
