import { COUNTDOWN_INTERVAL_MS } from "./constants.js";

export default class Countdown {
  constructor(type = "depart") {
    this.type = type === "arrive" ? "arrive" : "depart";
    this.action = this.type === "arrive" ? "Arriving" : "Departing";
    this.end_time = null;
    this.hours = 0;
    this.minutes = 0;
    this.seconds = 0;
    this.late = false;
    this.confirmed_late = false;
    this.cancelled = false;
    this.loaded = false;
    this.timer_label = document.querySelector(`#${this.type}_cd_label`);
    this.timer_elem = document.querySelector(`#${this.type}_cd_timer`);
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
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
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
    if (!this.loaded || !this.timer_label || !this.timer_elem) return;

    if (this.cancelled) {
      this.timer_elem.textContent = "Cancelled";
      this.timer_label.textContent = "This Service Has Been";
      this.timer_elem.classList.add("cancelled-timer");
      this.timer_elem.classList.remove("status-timer");
      this.timer_elem.classList.remove("late");
      return;
    }

    this.timer_elem.classList.remove("cancelled-timer");

    if (!this.end_time) {
      this.timer_elem.textContent = "No Services";
      this.timer_label.textContent = "";
      this.timer_elem.classList.add("status-timer");
      this.timer_elem.classList.remove("late");
      return;
    }

    this.timer_elem.classList.remove("status-timer");

    this.timer_elem.textContent = `${String(this.hours).padStart(2, "0")}:${String(this.minutes).padStart(2, "0")}:${String(this.seconds).padStart(2, "0")}`;

    if (this.late) {
      if (this.confirmed_late) {
        this.timer_label.textContent = "Late By";
        this.timer_elem.classList.add("late");
      } else {
        this.timer_elem.textContent = "00:00:00";
        this.timer_label.textContent = `${this.action} Soon`;
        this.timer_elem.classList.remove("late");
      }
    } else {
      this.timer_label.textContent = `${this.action} In`;
      this.timer_elem.classList.remove("late");
    }
  }

  start() {
    setInterval(() => {
      if (this.end_time && !this.cancelled) {
        this.calc_times(this.time_remaining());
      }
      this.display_time();
    }, COUNTDOWN_INTERVAL_MS);
  }
}