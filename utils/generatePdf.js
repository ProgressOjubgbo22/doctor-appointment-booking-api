const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");

const HOSPITAL_NAME = "City Care Hospital";

/**
 * Streams a PDFKit document directly into the HTTP response as a
 * downloadable file. `buildFn(doc)` writes the content; this just
 * handles headers, piping, and closing the document.
 */
const streamPdfToResponse = (res, { filename, buildFn }) => {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  doc.pipe(res);
  buildFn(doc);
  doc.end();
};

// Simple "Label: value" line, falls back to "-" when empty.
const line = (doc, label, value) => {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value || "-");
};

const title = (doc, text) => {
  doc.fontSize(18).font("Helvetica-Bold").text(HOSPITAL_NAME);
  doc.fontSize(12).font("Helvetica").text(text);
  doc.moveDown();
  doc.fontSize(10);
};

/**
 * Builds a simple, readable prescription PDF.
 * data: { prescriptionId, patient, doctor, medicationName, dosage,
 *   frequency, duration, instructions, issuedAt }
 */
const buildPrescriptionPdf = (doc, data) => {
  title(doc, "Prescription");

  line(doc, "Prescription ID", String(data.prescriptionId));
  line(doc, "Date Issued", dayjs(data.issuedAt).format("MMMM D, YYYY"));
  line(doc, "Patient", data.patient ? `${data.patient.firstName} ${data.patient.lastName}` : "N/A");
  line(doc, "Doctor", data.doctor ? `Dr. ${data.doctor.firstName} ${data.doctor.lastName}` : "N/A");
  doc.moveDown();

  line(doc, "Medication", data.medicationName);
  line(doc, "Dosage", data.dosage);
  line(doc, "Frequency", data.frequency);
  line(doc, "Duration", data.duration);
  doc.moveDown();

  doc.font("Helvetica-Bold").text("Instructions:");
  doc.font("Helvetica").text(data.instructions || "No additional instructions provided.");

  doc.moveDown(2);
  doc.fontSize(8).fillColor("gray").text("This is a computer-generated document.", { align: "center" });
};

/**
 * Builds a simple, readable invoice/receipt PDF.
 * data: { invoiceId, date, patient, doctor, appointment, amount,
 *   paymentMethod, paymentStatus }
 */
const buildInvoicePdf = (doc, data) => {
  title(doc, "Invoice / Receipt");

  line(doc, "Invoice ID", String(data.invoiceId));
  line(doc, "Date", dayjs(data.date).format("MMMM D, YYYY"));
  line(doc, "Status", data.paymentStatus ? data.paymentStatus.toUpperCase() : "N/A");
  line(doc, "Billed To", data.patient ? `${data.patient.firstName} ${data.patient.lastName}` : "N/A");
  line(doc, "Doctor", data.doctor ? `Dr. ${data.doctor.firstName} ${data.doctor.lastName}` : "N/A");
  if (data.appointment) {
    line(doc, "Appointment", `${data.appointment.appointmentDate} at ${data.appointment.startTime}`);
  }
  doc.moveDown();

  line(doc, "Consultation Fee", `$${Number(data.amount).toFixed(2)}`);
  line(doc, "Payment Method", (data.paymentMethod || "").replace("_", " ").toUpperCase());
  doc.moveDown(0.5);
  doc.fontSize(12).font("Helvetica-Bold").text(`Total Paid: $${Number(data.amount).toFixed(2)}`);

  doc.moveDown(2);
  doc.fontSize(8).font("Helvetica").fillColor("gray").text("Thank you for choosing " + HOSPITAL_NAME + ".", { align: "center" });
};

module.exports = { streamPdfToResponse, buildPrescriptionPdf, buildInvoicePdf };
