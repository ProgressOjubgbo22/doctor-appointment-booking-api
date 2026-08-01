const dayjs = require("dayjs");

/**
 * Generate bookable time slots for a given day based on a doctor's
 * availability window, break time, slot duration, and already booked
 * appointment times.
 */
const generateSlots = ({
  date,
  startTime,
  endTime,
  breakStartTime,
  breakEndTime,
  slotDurationMinutes = 30,
  bookedSlots = [],
}) => {
  const slots = [];
  let cursor = dayjs(`${date} ${startTime}`, "YYYY-MM-DD HH:mm");
  const end = dayjs(`${date} ${endTime}`, "YYYY-MM-DD HH:mm");

  const breakStart = breakStartTime ? dayjs(`${date} ${breakStartTime}`, "YYYY-MM-DD HH:mm") : null;
  const breakEnd = breakEndTime ? dayjs(`${date} ${breakEndTime}`, "YYYY-MM-DD HH:mm") : null;

  while (cursor.add(slotDurationMinutes, "minute").isSame(end) || cursor.add(slotDurationMinutes, "minute").isBefore(end)) {
    const slotStart = cursor;
    const slotEnd = cursor.add(slotDurationMinutes, "minute");

    const withinBreak =
      breakStart && breakEnd && slotStart.isBefore(breakEnd) && slotEnd.isAfter(breakStart);

    const isBooked = bookedSlots.some(
      (b) => b.startTime === slotStart.format("HH:mm")
    );

    if (!withinBreak && !isBooked) {
      slots.push({
        startTime: slotStart.format("HH:mm"),
        endTime: slotEnd.format("HH:mm"),
      });
    }

    cursor = slotEnd;
  }

  return slots;
};

module.exports = generateSlots;
