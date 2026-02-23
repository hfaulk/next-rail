document.querySelector("#locate").addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const closest = await findStation(latitude, longitude);
        setStation(closest.crs, closest.name);
      },
      (err) => console.error("location error:", err),
    );
  } else {
    console.error("geolocation not supported");
  }
});

function setStation(crs, name) {
  document.querySelector("#stat_name").textContent = name;
  document.querySelector("#stat_code").textContent = crs;
  updateDisplay(crs, cd);
  console.log("updated");
}

// Countdown timer
class Countdown {
  constructor(end_time_string, on_end) {
    if (end_time_string == "") {
      this.end_time = "";
    } else {
      this.end_time = this.string_to_time(end_time_string);
    }

    this.on_end = on_end;

    this.hours;
    this.minutes;
    this.seconds;

    this.late = false;

    this.timer_label = document.querySelector("#cd_label");
    this.timer_elem = document.querySelector("#cd_timer");
  }

  new_time(time_string) {
    if (time_string === "") {
      this.end_time = "";
    } else {
      this.end_time = this.string_to_time(time_string);
    }
  }

  string_to_time(time_string) {
    const [hours, minutes] = time_string.split(":");
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return date;
  }

  time_remaining() {
    const currentTime = new Date().getTime();
    return this.end_time.getTime() - currentTime;
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

  start() {
    setInterval(() => {
      if (this.end_time !== "") {
        const time_remains = this.time_remaining();
        this.calc_times(time_remains);
        if (this.late) {
          this.timer_elem.classList.add("late");
        } else {
          this.timer_elem.classList.remove("late");
        }
      }
      this.display_time();
    }, 1000);
  }

  display_time() {
    if (this.end_time === "") {
      this.timer_elem.textContent = "No Services";
      this.timer_label.textContent = "";
    } else {
      this.timer_elem.textContent = `${String(this.hours).padStart(2, "0")}:${String(this.minutes).padStart(2, "0")}:${String(this.seconds).padStart(2, "0")}`;

      if (this.late) {
        this.timer_label.textContent = "Late By";
      } else {
        this.timer_label.textContent = "Departing In";
      }
    }
  }
}

// Updating DOM with service/departure info
function getJourneyLength(start, end) {
  const toMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const startMins = toMinutes(start);
  const endMins = toMinutes(end);

  let diff = endMins - startMins;

  if (diff < 0) {
    diff += 24 * 60;
  }

  const durationHours = Math.floor(diff / 60);
  const durationMins = diff % 60;

  return {
    totalMinutes: diff,
    formatted: `${durationHours}h ${durationMins}m`,
  };
}

function setNoServices(cd) {
  document.querySelector("#from").textContent = "-";
  document.querySelector("#to").textContent = "-";
  document.querySelector("#depart_time").textContent = "-";
  document.querySelector("#platform_num").textContent = "-";
  document.querySelector("#stop_num").textContent = "-";
  document.querySelector("#cars_num").textContent = "-";
  document.querySelector("#jt_time").textContent = "-";
  document.querySelector("#op_name").textContent = "-";
  cd.new_time("");
}

async function updateDisplay(crs, cd) {
  // Fetch info about departures
  const response1 = await fetch(`/api/departures/${crs}`);
  const trainData = await response1.json();

  // Handle no services
  if (!trainData["trainServices"] || trainData["trainServices"].length === 0) {
    setNoServices(cd);
    return;
  }

  // Start parsing the fetched data
  const serviceInfoBasic = trainData["trainServices"][0];
  const serviceId = serviceInfoBasic["serviceIdGuid"];
  const departure_time = serviceInfoBasic["std"];

  // Fetch more detailed info about specific service
  const response2 = await fetch(`/api/services/${serviceId}`);
  const serviceData = await response2.json();

  // Guard against missing calling points
  if (!serviceData["subsequentCallingPoints"]) {
    setNoServices(cd);
    return;
  }

  // Get relevant data about service
  const stop_num =
    serviceData["subsequentCallingPoints"][0]["callingPoint"].length;
  const journey_length = getJourneyLength(
    departure_time,
    serviceData["subsequentCallingPoints"][0]["callingPoint"].at(-1)["st"],
  );

  // Get DOM elements
  const from = document.querySelector("#from");
  const to = document.querySelector("#to");
  const depart_time = document.querySelector("#depart_time");
  const platform = document.querySelector("#platform_num");
  const stops = document.querySelector("#stop_num");
  const carriages = document.querySelector("#cars_num");
  const journey_time = document.querySelector("#jt_time");
  const operator = document.querySelector("#op_name");

  from.textContent = serviceInfoBasic["origin"][0]["crs"];
  to.textContent = serviceInfoBasic["destination"][0]["crs"];
  depart_time.textContent = departure_time;
  platform.textContent = serviceInfoBasic["platform"] ?? "-";
  stops.textContent = stop_num;
  carriages.textContent = serviceInfoBasic["length"]
    ? serviceInfoBasic["length"]
    : "-";
  journey_time.textContent = journey_length.formatted;
  operator.textContent = serviceInfoBasic["operator"];

  cd.new_time(departure_time ? departure_time : "");
}

// Finding station
function radian(deg) {
  return (Math.PI / 180) * deg;
}

function haversine(lat1, long1, lat2, long2) {
  const delta_lat = radian(lat2) - radian(lat1);
  const delta_long = radian(long2) - radian(long1);

  const RAD_EARTH = 6371;

  const a =
    Math.sin(delta_lat / 2) ** 2 +
    Math.cos(radian(lat1)) *
      Math.cos(radian(lat2)) *
      Math.sin(delta_long / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return c * RAD_EARTH;
}

async function findStation(usr_lat, usr_long) {
  let distances = [];

  const response = await fetch(`/api/stations`);
  const stations = await response.json();

  for (const station of stations) {
    distances.push({
      crs: station["3alpha"],
      name: station["station_name"],
      hav: haversine(
        usr_lat,
        usr_long,
        station["latitude"],
        station["longitude"],
      ),
    });
  }

  let closest = distances[0];
  for (const station of distances) {
    if (station["hav"] <= closest["hav"]) {
      closest = station;
    }
  }

  return closest;
}

function updateLocation(position) {
  const { latitude, longitude } = position.coords;

  const long = document.querySelector("#long");
  const lat = document.querySelector("#lat");

  long.textContent = `Longitude: ${longitude}`;
  lat.textContent = `Latitude: ${latitude}`;
}

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(updateLocation, (err) =>
    console.error("location error:", err),
  );
} else {
  console.error("geolocation not supported");
}

// Start app
const cd = new Countdown("", "", "");
cd.start();
