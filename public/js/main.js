import Countdown from "./countdown.js";
import {
  DISPLAY_REFRESH_MS,
  GEOLOCATION_REFRESH_MS,
  CANCELLATION_LINGER_MS,
  EARTH_RADIUS_KM,
} from "./constants.js";

// Shared State
let currentCrs = null;
const currentServiceId = { depart: null, arrive: null };
let displayRefreshTimer = null;
const cancellationLingerTimer = { depart: null, arrive: null };

// Countdowns
const depart_countdown = new Countdown("depart");
depart_countdown.start();

const arrive_countdown = new Countdown("arrive");
arrive_countdown.start();

function getCountdown(type = "depart") {
  return type === "arrive" ? arrive_countdown : depart_countdown;
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

function clearDisplay(type = "depart") {
  const fields = [
    "from", "to", "time", "platform_num",
    "stop_num", "cars_num", "jt_time", "op_name",
  ];
  const timeFieldId = type === "arrive" ? "arrive_depart_time" : `${type}_time`;

  for (const id of fields) {
    const fieldId = id === "time" ? timeFieldId : `${type}_${id}`;
    document.querySelector(`#${fieldId}`).textContent = "-";
  }
  getCountdown(type).set_time("");
}

function showCancellation(type = "depart", reason) {
  const cancelReasonEl = document.querySelector(`#${type}_cancel_reason`);
  cancelReasonEl.textContent = reason ?? "This service has been cancelled.";
  cancelReasonEl.hidden = false;
  getCountdown(type).set_cancelled();

  cancellationLingerTimer[type] = setTimeout(() => {
    cancellationLingerTimer[type] = null;
    cancelReasonEl.hidden = true;
    cancelReasonEl.textContent = "";
    currentServiceId[type] = null;
    updateDisplay(type, currentCrs);
  }, CANCELLATION_LINGER_MS);
}

async function updateDisplay(type = "depart", crs) {
  if (cancellationLingerTimer[type]) return;

  try {
    const departuresRes = await fetch(`/api/departures/${crs}`);
    const departuresData = await departuresRes.json();

    const services = departuresData.trainServices;
    if (!services?.length) {
      clearDisplay(type);
      return;
    }

    if (currentServiceId[type]) {
      const currentInList = services.find(
        (s) => s.serviceIdGuid === currentServiceId[type],
      );
      if (currentInList?.isCancelled) {
        showCancellation(type, currentInList.cancelReason);
        return;
      }
    }

    const firstService = services.find((s) => !s.isCancelled);
    if (!firstService) {
      clearDisplay(type);
      return;
    }

    const serviceRes = await fetch(`/api/services/${firstService.serviceIdGuid}`);
    const serviceData = await serviceRes.json();

    const callingPoints = serviceData.subsequentCallingPoints?.[0]?.callingPoint;
    if (!callingPoints) {
      clearDisplay(type);
      return;
    }

    if (serviceData.isCancelled) {
      showCancellation(type, serviceData.cancelReason);
      return;
    }

    currentServiceId[type] = firstService.serviceIdGuid;

    const scheduledTime = firstService.std;
    const estimatedTime = firstService.etd;
    const isDelayed = estimatedTime?.length === 5;
    const departureTime = isDelayed ? estimatedTime : scheduledTime;

    const lastStop = callingPoints.at(-1);
    const arrivalTime = lastStop.et?.length === 5 ? lastStop.et : lastStop.st;
    const timeFieldId = type === "arrive" ? "arrive_depart_time" : `${type}_time`;

    document.querySelector(`#${type}_from`).textContent = firstService.origin[0].crs;
    document.querySelector(`#${type}_to`).textContent = firstService.destination[0].crs;
    document.querySelector(`#${type}_platform_num`).textContent = firstService.platform ?? "-";
    document.querySelector(`#${type}_stop_num`).textContent = callingPoints.length;
    document.querySelector(`#${type}_cars_num`).textContent = firstService.length || "-";
    document.querySelector(`#${type}_jt_time`).textContent = getJourneyDuration(departureTime, arrivalTime);
    document.querySelector(`#${type}_op_name`).textContent = firstService.operator;

    const timeEl = document.querySelector(`#${timeFieldId}`);
    timeEl.textContent = departureTime;
    timeEl.classList.toggle("late", isDelayed);

    const cancelReasonEl = document.querySelector(`#${type}_cancel_reason`);
    cancelReasonEl.hidden = true;
    cancelReasonEl.textContent = "";

    if (isDelayed) {
      getCountdown(type).set_late(departureTime);
    } else {
      getCountdown(type).set_time(departureTime ?? "");
    }

    const upcoming = services.filter((s) => s !== firstService).slice(0, 3);
    const nextSlots = [`#next_${type}_1`, `#next_${type}_2`, `#next_${type}_3`];
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

// Station
function setStation(crs, name) {
  document.querySelector("#stat_name").textContent = name;
  document.querySelector("#stat_code").textContent = crs;

  currentCrs = crs;

  updateDisplay("depart", crs);
  updateDisplay("arrive", crs);
  clearInterval(displayRefreshTimer);
  displayRefreshTimer = setInterval(() => {
    updateDisplay("depart", currentCrs);
    updateDisplay("arrive", currentCrs);
  }, DISPLAY_REFRESH_MS);
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

// Station Search
let allStations = null;

async function loadStations() {
  if (allStations) return allStations;
  const res = await fetch("/api/stations");
  allStations = await res.json();
  return allStations;
}

function showStationSearch() {
  document.querySelector("#search_input").focus();
}

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

document.addEventListener("click", (e) => {
  if (!e.target.closest("#station_search")) {
    searchResults.hidden = true;
    highlightedIndex = -1;
  }
});

// Initialise
loadStations(); // Preloading search results
refreshLocation();
setInterval(refreshLocation, GEOLOCATION_REFRESH_MS);
document.querySelector("#locate").addEventListener("click", refreshLocation);