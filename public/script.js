// Constants
const EARTH_RADIUS_KM = 6_371;
const COUNTDOWN_INTERVAL_MS = 1_000;
const DISPLAY_REFRESH_MS = 10_000; // Re-fetch departure data every 30 seconds
const GEOLOCATION_REFRESH_MS = 3_600_000; // Re-check location every 60 minutes
const CANCELLATION_LINGER_MS = 6_000; // How long to show "Cancelled" before moving on

// Station
let currentCrs = null;
let displayRefreshTimer = null;
let currentServiceId = null; // serviceIdGuid of the service showing
let cancellationLingerTimer = null; // ensures cancellation remains for the full time even after new data

function setStation(crs, name) {
  document.querySelector("#stat_name").textContent = name;
  document.querySelector("#stat_code").textContent = crs;

  currentCrs = crs;

  updateDisplay(crs);
  clearInterval(displayRefreshTimer);
  displayRefreshTimer = setInterval(
    () => updateDisplay(currentCrs),
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
  document.querySelector("#search_input").focus();
}

// Preload stations list
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
    .sort(
      (a, b) =>
        b.station_name.toLowerCase().startsWith(query) -
        a.station_name.toLowerCase().startsWith(query),
    )
    .slice(0, 8);

  if (!matches.length) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }

  searchResults.innerHTML = matches
    .map(
      (s) => `
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
  constructor() {
    this.end_time = null;
    this.hours = 0;
    this.minutes = 0;
    this.seconds = 0;
    this.late = false;
    this.confirmed_late = false;
    this.cancelled = false;
    this.loaded = false;
    this.timer_label = document.querySelector("#cd_label");
    this.timer_elem = document.querySelector("#cd_timer");
  }

  set_time(time_string) {
    this.end_time = time_string ? this.string_to_time(time_string) : null;
    this.cancelled = false;
    this.confirmed_late = false;
    this.loaded = true;
  }

  set_late(time_string) {
    this.end_time = this.string_to_time(time_string);
    this.cancelled = false;
    this.confirmed_late = true;
    this.loaded = true;
  }

  set_cancelled() {
    this.end_time = null;
    this.cancelled = true;
    this.loaded = true;
  }

  string_to_time(time_string) {
    const [hours, minutes] = time_string.split(":");
    const date = new Date(); // New date object with current date & time
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0); // Replace hours & mins with parsed info
    return date;
  }

  time_remaining() {
    return this.end_time.getTime() - new Date().getTime();
  }

  calc_times(milli) {
    if (milli < 0) {
      milli = -milli;
      this.late = true;
    } else {
      this.late = false;
    }
    this.hours = Math.floor(milli / (1000 * 60 * 60));
    this.minutes = Math.floor((milli / 60000) % 60);
    this.seconds = Math.floor((milli / 1000) % 60);
  }

  display_time() {
    if (!this.loaded) return;

    if (this.cancelled) {
      this.timer_elem.textContent = "Cancelled";
      this.timer_label.textContent = "This Service Has Been";
      this.timer_elem.classList.add("cancelled-timer");
      this.timer_elem.classList.remove("late");
      return;
    }

    this.timer_elem.classList.remove("cancelled-timer");

    if (!this.end_time) {
      this.timer_elem.textContent = "No Services";
      this.timer_label.textContent = "";
      this.timer_elem.classList.remove("late");
      return;
    }

    this.timer_elem.textContent = `${String(this.hours).padStart(2, "0")}:${String(this.minutes).padStart(2, "0")}:${String(this.seconds).padStart(2, "0")}`;

    if (this.late) {
      if (this.confirmed_late) {
        this.timer_label.textContent = "Late By";
        this.timer_elem.classList.add("late");
      } else {
        // Scheduled time has passed but no revised time yet — hold at zero
        this.timer_elem.textContent = "00:00:00";
        this.timer_label.textContent = "Departing Soon";
        this.timer_elem.classList.remove("late");
      }
    } else {
      this.timer_label.textContent = "Departing In";
      this.timer_elem.classList.remove("late");
    }
  }

  start() {
    setInterval(() => {
      if (this.end_time && !this.cancelled) {
        this.calc_times(this.time_remaining());
      }
      this.display_time();
    }, 1000);
  }
}

// Display
function getJourneyDuration(start, end) {
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += 24 * 60; // Handle overnight journeys

  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

function clearDisplay() {
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
  countdown.set_time("");
}

function showCancellation(reason) {
  const cancelReasonEl = document.querySelector("#cancel_reason");
  cancelReasonEl.textContent = reason ?? "This service has been cancelled.";
  cancelReasonEl.hidden = false;
  countdown.set_cancelled();

  cancellationLingerTimer = setTimeout(() => {
    cancellationLingerTimer = null;
    cancelReasonEl.hidden = true;
    cancelReasonEl.textContent = "";
    currentServiceId = null;
    updateDisplay(currentCrs);
  }, CANCELLATION_LINGER_MS);
}

async function updateDisplay(crs) {
  // If we're in the middle of showing a cancellation notice, don't override it
  if (cancellationLingerTimer) return;

  try {
    const departuresRes = await fetch(`/api/departures/${crs}`);
    const departuresData = await departuresRes.json();

    const services = departuresData.trainServices;
    if (!services?.length) {
      clearDisplay();
      return;
    }

    // Check if the service we're currently displaying has become cancelled
    if (currentServiceId) {
      const currentInList = services.find(
        (s) => s.serviceIdGuid === currentServiceId,
      );
      if (currentInList?.isCancelled) {
        showCancellation(currentInList.cancelReason);
        return;
      }
    }

    // Find the first non-cancelled service for the main display
    const firstService = services.find((s) => !s.isCancelled);
    if (!firstService) {
      clearDisplay();
      return;
    }

    const serviceRes = await fetch(
      `/api/services/${firstService.serviceIdGuid}`,
    );
    const serviceData = await serviceRes.json();

    const callingPoints =
      serviceData.subsequentCallingPoints?.[0]?.callingPoint;
    if (!callingPoints) {
      clearDisplay();
      return;
    }

    // Guard: service detail says cancelled (updated between the two fetches)
    if (serviceData.isCancelled) {
      showCancellation(serviceData.cancelReason);
      return;
    }

    // Normal update
    currentServiceId = firstService.serviceIdGuid;

    const scheduledTime = firstService.std;
    const estimatedTime = firstService.etd;
    // The API returns "On time" or "Delayed" as the estimated time when there's
    // no specific revised time, so a 5-character string means an actual time e.g. "14:32"
    const isDelayed = estimatedTime?.length === 5;
    const departureTime = isDelayed ? estimatedTime : scheduledTime;

    const lastStop = callingPoints.at(-1);
    const arrivalTime = lastStop.et?.length === 5 ? lastStop.et : lastStop.st;
    document.querySelector("#from").textContent = firstService.origin[0].crs;
    document.querySelector("#to").textContent = firstService.destination[0].crs;
    document.querySelector("#platform_num").textContent =
      firstService.platform ?? "-";
    document.querySelector("#stop_num").textContent = callingPoints.length;
    document.querySelector("#cars_num").textContent =
      firstService.length || "-";
    document.querySelector("#jt_time").textContent = getJourneyDuration(
      departureTime,
      arrivalTime,
    );
    document.querySelector("#op_name").textContent = firstService.operator;

    const departEl = document.querySelector("#depart_time");
    departEl.textContent = departureTime;
    departEl.classList.toggle("late", isDelayed);

    const cancelReasonEl = document.querySelector("#cancel_reason");
    cancelReasonEl.hidden = true;
    cancelReasonEl.textContent = "";

    if (isDelayed) {
      countdown.set_late(departureTime);
    } else {
      countdown.set_time(departureTime ?? "");
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

  let closest = null;
  let closestDist = Infinity;

  for (const station of stations) {
    const dist = haversine(lat, lon, station.latitude, station.longitude);
    if (dist < closestDist) {
      closestDist = dist;
      closest = station;
    }
  }

  return { crs: closest["3alpha"], name: closest.station_name };
}

// Initialise
const countdown = new Countdown();
countdown.start();

refreshLocation();
setInterval(refreshLocation, GEOLOCATION_REFRESH_MS);
