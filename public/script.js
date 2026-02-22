// function updateLocation(position) {
//   const { latitude, longitude } = position.coords;

//   const long = document.querySelector("#long");
//   const lat = document.querySelector("#lat");

//   long.textContent = `Longitude: ${longitude}`;
//   lat.textContent = `Latitude: ${latitude}`;
// }

// if (navigator.geolocation) {
//   navigator.geolocation.getCurrentPosition(updateLocation, (err) =>
//     console.error("location error:", err),
//   );
// } else {
//   console.error("geolocation not supported");
// }

document.querySelector("#locate").addEventListener("click", setStation);

function setStation() {
  const stat_name = document.querySelector("#stat_name");
  const stat_code = document.querySelector("#stat_code");

  const from = document.querySelector("#from");
  const to = document.querySelector("#to");

  const op_name = document.querySelector("#op_name");

  const cd_timer = document.querySelector("#cd_timer");

  if (stat_name.textContent == "Portsmouth Harbour") {
    stat_name.textContent = "Rhoose Cardiff International Airport";
    stat_code.textContent = "RIA";

    from.textContent = "RIA";
    to.textContent = "CDF";

    cd_timer.textContent = "00:03:24";

    op_name.textContent = "Transport for Wales";
  } else {
    stat_name.textContent = "Portsmouth Harbour";
    stat_code.textContent = "PMH";

    from.textContent = "PMH";
    to.textContent = "WAT";

    op_name.textContent = "South Western Railway";

    cd_timer.textContent = "01:23:45";
  }
}

class Countdown {
  constructor(end_time_string, on_end) {
    this.end_time = this.string_to_time(end_time_string);
    this.on_end = on_end;

    this.hours;
    this.minutes;
    this.seconds;

    this.late = false;

    this.timer_label = document.querySelector("#cd_label");
    this.timer_elem = document.querySelector("#cd_timer");
  }

  new_time(time_string) {
    this.end_time = this.string_to_time(time_string);
  }

  string_to_time(time_string) {
    const [hours, minutes] = time_string.split(":");
    const date = new Date(); // New date object with current date & time
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0); // Replace hours & mins with parsed info
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
      const time_remains = this.time_remaining();
      this.calc_times(time_remains);
      if (this.late) {
        this.timer_elem.classList.add("late");
      } else {
        this.timer_elem.classList.remove("late");
      }
      //this.on_end();
      this.display_time();
    }, 1000);
  }

  display_time() {
    this.timer_elem.textContent = `${String(this.hours).padStart(2, "0")}:${String(this.minutes).padStart(2, "0")}:${String(this.seconds).padStart(2, "0")}`;

    if (this.late) {
      this.timer_label.textContent = "Late By";
    } else {
      this.timer_label.textContent = "Departing In";
    }
  }
}

const cd = new Countdown("20:45", "", "");
console.log(cd.hours, cd.minutes, cd.seconds);
cd.start();
