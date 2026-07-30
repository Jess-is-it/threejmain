from __future__ import annotations

from datetime import date, datetime
from textwrap import wrap
from typing import Any


PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
LEFT = 42.0
RIGHT = PAGE_WIDTH - 42.0
BOTTOM = 58.0
TEXT = (0.07, 0.10, 0.16)
MUTED = (0.38, 0.44, 0.53)
ACCENT = (0.06, 0.48, 0.31)
DANGER = (0.73, 0.11, 0.11)
WARNING = (0.72, 0.42, 0.04)
LINE = (0.84, 0.87, 0.91)
SOFT = (0.95, 0.97, 0.98)
ISSUER_NAME = "3J COMPUTER AND INTERNET INSTALLATION SERVICES"
ISSUER_ADDRESS = "Zone 2, Roma Norte, Enrile, Cagayan 3501"


def _clean(value: Any, fallback: str = "-") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def _money(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return f"PHP {amount:,.2f}"


def _signed_money(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if amount < 0:
        return f"- {_money(abs(amount))}"
    if amount > 0:
        return f"+ {_money(amount)}"
    return _money(0)


def _quantity(value: Any) -> str:
    try:
        return f"{float(value or 0):g}"
    except (TypeError, ValueError):
        return _clean(value)


def _date_label(value: Any) -> str:
    text = _clean(value, "")
    if not text:
        return "-"
    try:
        parsed = date.fromisoformat(text[:10])
    except ValueError:
        return text
    return parsed.strftime("%b %d, %Y").replace(" 0", " ")


def _date_time_label(value: Any) -> str:
    text = _clean(value, "")
    if not text:
        return "-"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    return parsed.strftime("%b %d, %Y %H:%M").replace(" 0", " ")


def _customer_name(customer: dict[str, Any]) -> str:
    parts = [
        _clean(customer.get("firstName"), ""),
        _clean(customer.get("middleName"), ""),
        _clean(customer.get("lastName"), ""),
    ]
    return " ".join(part for part in parts if part) or _clean(customer.get("name"), "Unnamed customer")


def _wrap_text(value: Any, width_points: float, font_size: float = 9.0) -> list[str]:
    text = _clean(value)
    character_width = max(1, int(width_points / max(font_size * 0.52, 1)))
    return wrap(
        text,
        width=character_width,
        break_long_words=True,
        break_on_hyphens=True,
        replace_whitespace=True,
        drop_whitespace=True,
    ) or ["-"]


def _escape_pdf_text(value: Any) -> bytes:
    raw = _clean(value, "").encode("cp1252", "replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


class _PdfCanvas:
    def __init__(self) -> None:
        self.pages: list[bytearray] = []
        self.current_page = -1

    def add_page(self) -> int:
        self.pages.append(bytearray())
        self.current_page = len(self.pages) - 1
        return self.current_page

    def _append(self, command: bytes, page: int | None = None) -> None:
        target = self.current_page if page is None else page
        self.pages[target].extend(command)

    def text(
        self,
        x: float,
        y: float,
        value: Any,
        size: float = 9.0,
        *,
        bold: bool = False,
        color: tuple[float, float, float] = TEXT,
        page: int | None = None,
    ) -> None:
        font = "F2" if bold else "F1"
        prefix = (
            f"BT /{font} {size:.2f} Tf {color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg "
            f"1 0 0 1 {x:.2f} {y:.2f} Tm ("
        ).encode("ascii")
        self._append(prefix + _escape_pdf_text(value) + b") Tj ET\n", page)

    def right_text(
        self,
        right: float,
        y: float,
        value: Any,
        size: float = 9.0,
        *,
        bold: bool = False,
        color: tuple[float, float, float] = TEXT,
        page: int | None = None,
    ) -> None:
        text = _clean(value, "")
        estimated_width = len(text) * size * (0.56 if bold else 0.52)
        self.text(max(LEFT, right - estimated_width), y, text, size, bold=bold, color=color, page=page)

    def line(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        width: float = 0.7,
        color: tuple[float, float, float] = LINE,
        page: int | None = None,
    ) -> None:
        command = (
            f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} RG {width:.2f} w "
            f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S\n"
        ).encode("ascii")
        self._append(command, page)

    def fill_rect(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        *,
        color: tuple[float, float, float] = SOFT,
        page: int | None = None,
    ) -> None:
        command = (
            f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg "
            f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re f\n"
        ).encode("ascii")
        self._append(command, page)

    def to_bytes(self) -> bytes:
        objects: list[bytes | None] = [None, None, None]
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        page_ids: list[int] = []
        for stream in self.pages:
            page_id = len(objects)
            content_id = page_id + 1
            page_ids.append(page_id)
            objects.append(
                (
                    f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] "
                    f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>"
                ).encode("ascii")
            )
            stream_bytes = bytes(stream)
            objects.append(
                f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
                + stream_bytes
                + b"endstream"
            )

        objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
        kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
        objects[2] = f"<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>".encode("ascii")

        output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for object_id, body in enumerate(objects[1:], start=1):
            offsets.append(len(output))
            output.extend(f"{object_id} 0 obj\n".encode("ascii"))
            output.extend(body or b"")
            output.extend(b"\nendobj\n")

        xref_offset = len(output)
        output.extend(f"xref\n0 {len(objects)}\n".encode("ascii"))
        output.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        output.extend(
            (
                f"trailer\n<< /Size {len(objects)} /Root 1 0 R >>\n"
                f"startxref\n{xref_offset}\n%%EOF\n"
            ).encode("ascii")
        )
        return bytes(output)


class _InvoiceLayout:
    def __init__(self, canvas: _PdfCanvas, invoice_number: str) -> None:
        self.canvas = canvas
        self.invoice_number = invoice_number
        self.y = 0.0

    def first_page(self) -> None:
        self.canvas.add_page()
        self.canvas.text(LEFT, 814, ISSUER_NAME, 9, bold=True, color=ACCENT)
        self.canvas.text(LEFT, 800, ISSUER_ADDRESS, 8, color=MUTED)
        self.canvas.text(LEFT, 768, "BILLING INVOICE", 22, bold=True)
        self.canvas.text(LEFT, 747, self.invoice_number, 10, color=MUTED)
        self.canvas.line(LEFT, 733, RIGHT, 733, width=1.0)
        self.y = 713

    def next_page(self) -> None:
        self.canvas.add_page()
        self.canvas.text(LEFT, 814, ISSUER_NAME, 9, bold=True, color=ACCENT)
        self.canvas.text(LEFT, 800, ISSUER_ADDRESS, 8, color=MUTED)
        self.canvas.text(LEFT, 774, f"INVOICE {self.invoice_number} - CONTINUED", 13, bold=True)
        self.canvas.line(LEFT, 758, RIGHT, 758, width=1.0)
        self.y = 738

    def ensure(self, height: float) -> bool:
        if self.y - height >= BOTTOM:
            return False
        self.next_page()
        return True

    def section(self, title: str) -> None:
        self.ensure(30)
        self.canvas.line(LEFT, self.y, RIGHT, self.y)
        self.y -= 17
        self.canvas.text(LEFT, self.y, title.upper(), 8, bold=True, color=MUTED)
        self.y -= 15


def _draw_label_value(
    canvas: _PdfCanvas,
    x: float,
    y: float,
    label: str,
    value: Any,
    *,
    value_x: float | None = None,
) -> None:
    canvas.text(x, y, label.upper(), 7, bold=True, color=MUTED)
    canvas.text(value_x if value_x is not None else x + 82, y, value, 9)


def _draw_charge_header(layout: _InvoiceLayout) -> None:
    canvas = layout.canvas
    canvas.fill_rect(LEFT, layout.y - 16, RIGHT - LEFT, 21)
    canvas.text(LEFT + 8, layout.y - 10, "DESCRIPTION", 7, bold=True, color=MUTED)
    canvas.text(340, layout.y - 10, "QTY", 7, bold=True, color=MUTED)
    canvas.text(404, layout.y - 10, "UNIT PRICE", 7, bold=True, color=MUTED)
    canvas.right_text(RIGHT - 8, layout.y - 10, "AMOUNT", 7, bold=True, color=MUTED)
    layout.y -= 23


def _draw_previous_invoice_header(layout: _InvoiceLayout) -> None:
    canvas = layout.canvas
    canvas.fill_rect(LEFT, layout.y - 16, RIGHT - LEFT, 21)
    canvas.text(LEFT + 7, layout.y - 10, "INVOICE", 7, bold=True, color=MUTED)
    canvas.text(170, layout.y - 10, "BILLING PERIOD", 7, bold=True, color=MUTED)
    canvas.text(315, layout.y - 10, "DUE DATE", 7, bold=True, color=MUTED)
    canvas.text(405, layout.y - 10, "STATUS", 7, bold=True, color=MUTED)
    canvas.right_text(RIGHT - 7, layout.y - 10, "REMAINING", 7, bold=True, color=MUTED)
    layout.y -= 23


def _render_account_summary(layout: _InvoiceLayout, invoice: dict[str, Any]) -> None:
    summary = invoice.get("accountSummaryAtIssue")
    if not isinstance(summary, dict):
        return

    layout.ensure(70)
    layout.section("Account summary at issue")
    layout.canvas.fill_rect(LEFT, layout.y - 13, RIGHT - LEFT, 23, color=(0.92, 0.98, 0.95))
    layout.canvas.text(LEFT + 7, layout.y - 5, "TOTAL ACCOUNT AMOUNT DUE", 10, bold=True, color=ACCENT)
    layout.canvas.right_text(
        RIGHT - 7,
        layout.y - 5,
        _money(summary.get("totalAccountAmountDue")),
        10,
        bold=True,
        color=ACCENT,
    )
    layout.y -= 32

    previous_invoices = summary.get("previousOpenInvoices")
    if not isinstance(previous_invoices, list) or not previous_invoices:
        return

    layout.section("Previous unpaid invoices")
    _draw_previous_invoice_header(layout)
    for previous_invoice in previous_invoices:
        if not isinstance(previous_invoice, dict):
            continue
        period = (
            previous_invoice.get("billingPeriodLabel")
            or previous_invoice.get("billingPeriodMonth")
            or f"{_date_label(previous_invoice.get('billingCycleStart'))} - "
            f"{_date_label(previous_invoice.get('billingCycleEnd'))}"
        )
        period_lines = _wrap_text(period, 130, 8)
        row_height = max(27, len(period_lines) * 11 + 9)
        if layout.y - row_height < BOTTOM:
            layout.next_page()
            layout.canvas.text(LEFT, layout.y, "PREVIOUS UNPAID INVOICES (CONTINUED)", 8, bold=True, color=MUTED)
            layout.y -= 18
            _draw_previous_invoice_header(layout)
        text_y = layout.y - 11
        status = "Overdue" if previous_invoice.get("isOverdueAtIssue") else _clean(
            previous_invoice.get("statusAtIssue")
        ).replace("_", " ").title()
        if previous_invoice.get("isOverdueAtIssue"):
            status = f"{status} {int(previous_invoice.get('daysOverdueAtIssue') or 0)}d"
        layout.canvas.text(LEFT + 7, text_y, previous_invoice.get("invoiceNumber"), 8, bold=True)
        for index, line in enumerate(period_lines):
            layout.canvas.text(170, text_y - index * 11, line, 8)
        layout.canvas.text(315, text_y, _date_label(previous_invoice.get("dueDate")), 8)
        layout.canvas.text(405, text_y, status, 8, color=DANGER if previous_invoice.get("isOverdueAtIssue") else TEXT)
        layout.canvas.right_text(
            RIGHT - 7,
            text_y,
            _money(previous_invoice.get("remainingBalanceAtIssue")),
            8,
            bold=True,
        )
        layout.y -= row_height
        layout.canvas.line(LEFT, layout.y, RIGHT, layout.y, width=0.5)


def _render_charges(layout: _InvoiceLayout, invoice: dict[str, Any]) -> None:
    layout.section("Charges")
    _draw_charge_header(layout)
    for item in invoice.get("lineItems") or []:
        description_lines = _wrap_text(item.get("description") or "Billing item", 280, 9)
        row_height = max(26, len(description_lines) * 12 + 10)
        if layout.y - row_height < BOTTOM:
            layout.next_page()
            layout.canvas.text(LEFT, layout.y, "CHARGES (CONTINUED)", 8, bold=True, color=MUTED)
            layout.y -= 18
            _draw_charge_header(layout)
        text_y = layout.y - 11
        for index, line in enumerate(description_lines):
            layout.canvas.text(LEFT + 8, text_y - index * 12, line, 9)
        layout.canvas.text(340, text_y, _quantity(item.get("quantity")), 9)
        layout.canvas.right_text(468, text_y, _money(item.get("unitPrice")), 9)
        layout.canvas.right_text(RIGHT - 8, text_y, _money(item.get("amount")), 9, bold=True)
        layout.y -= row_height
        layout.canvas.line(LEFT, layout.y, RIGHT, layout.y, width=0.5)


def _render_adjustments(layout: _InvoiceLayout, adjustments: list[dict[str, Any]]) -> None:
    if not adjustments:
        return
    layout.section("Adjustments and credits")
    for adjustment in adjustments:
        reason_lines = _wrap_text(adjustment.get("reason") or adjustment.get("notes") or "Adjustment", 290, 8.5)
        row_height = max(25, len(reason_lines) * 11 + 9)
        if layout.y - row_height < BOTTOM:
            layout.next_page()
            layout.canvas.text(LEFT, layout.y, "ADJUSTMENTS AND CREDITS (CONTINUED)", 8, bold=True, color=MUTED)
            layout.y -= 18
        label = adjustment.get("adjustmentLabel") or adjustment.get("adjustmentSource") or adjustment.get("type") or "Adjustment"
        layout.canvas.text(LEFT, layout.y - 10, _clean(label).replace("_", " ").title(), 8.5, bold=True)
        for index, line in enumerate(reason_lines):
            layout.canvas.text(190, layout.y - 10 - index * 11, line, 8.5)
        layout.canvas.text(430, layout.y - 10, _clean(adjustment.get("status")).replace("_", " ").title(), 8, color=MUTED)
        sign = "-" if adjustment.get("type") == "CREDIT" else "+"
        layout.canvas.right_text(RIGHT, layout.y - 10, f"{sign} {_money(adjustment.get('amount'))}", 8.5, bold=True)
        layout.y -= row_height
        layout.canvas.line(LEFT, layout.y, RIGHT, layout.y, width=0.5)


def _render_payments(layout: _InvoiceLayout, payments: list[dict[str, Any]]) -> None:
    if not payments:
        return
    layout.section("Payment activity")
    for payment in payments:
        if layout.y - 27 < BOTTOM:
            layout.next_page()
            layout.canvas.text(LEFT, layout.y, "PAYMENT ACTIVITY (CONTINUED)", 8, bold=True, color=MUTED)
            layout.y -= 18
        receipt = payment.get("receiptNumber") or ("Account credit" if payment.get("isCreditApplication") else "Payment")
        method = _clean(payment.get("method")).replace("_", " ").title()
        status = _clean(payment.get("status")).replace("_", " ").title()
        layout.canvas.text(LEFT, layout.y - 10, receipt, 8.5, bold=True)
        layout.canvas.text(190, layout.y - 10, _date_label(payment.get("paymentDate")), 8.5)
        layout.canvas.text(300, layout.y - 10, method, 8.5)
        layout.canvas.text(430, layout.y - 10, status, 8, color=MUTED)
        layout.canvas.right_text(RIGHT, layout.y - 10, _money(payment.get("amount")), 8.5, bold=True)
        layout.y -= 27
        layout.canvas.line(LEFT, layout.y, RIGHT, layout.y, width=0.5)


def _render_summary(layout: _InvoiceLayout, invoice: dict[str, Any]) -> None:
    has_account_credit = float(invoice.get("accountCreditAppliedTotal") or 0) > 0
    layout.ensure(145 if has_account_credit else 128)
    layout.section("Invoice summary")
    label_x = 315
    rows = [
        ("Subtotal", _money(invoice.get("subtotal"))),
        ("Adjustments", _signed_money(invoice.get("adjustmentsTotal"))),
        ("Invoice total", _money(invoice.get("total"))),
        ("Payments", f"- {_money(invoice.get('paymentTotal'))}"),
    ]
    if has_account_credit:
        rows.append(
            ("Account credits applied", f"- {_money(invoice.get('accountCreditAppliedTotal'))}")
        )
    for label, value in rows:
        layout.canvas.text(label_x, layout.y, label, 9, color=MUTED)
        layout.canvas.right_text(RIGHT, layout.y, value, 9)
        layout.y -= 17
    layout.canvas.line(label_x, layout.y + 7, RIGHT, layout.y + 7, width=1.0)
    balance_label = (
        "THIS INVOICE BALANCE DUE"
        if isinstance(invoice.get("accountSummaryAtIssue"), dict)
        else "BALANCE DUE"
    )
    layout.canvas.text(label_x, layout.y - 5, balance_label, 11, bold=True)
    layout.canvas.right_text(RIGHT, layout.y - 5, _money(invoice.get("balance")), 11, bold=True, color=ACCENT)
    layout.y -= 27
    if invoice.get("earlyBirdAvailableNow"):
        early_bird = (
            f"Early bird payable through {_date_label(invoice.get('earlyBirdAvailableUntil'))}: "
            f"{_money(invoice.get('earlyBirdPayableBalance'))}"
        )
        layout.canvas.right_text(RIGHT, layout.y, early_bird, 8, color=MUTED)
        layout.y -= 16


def _render_notes(layout: _InvoiceLayout, invoice: dict[str, Any]) -> None:
    notes: list[str] = []
    if _clean(invoice.get("notes"), ""):
        notes.append(_clean(invoice.get("notes")))
    if invoice.get("status") == "VOID":
        notes.append(
            f"Voided {_date_time_label(invoice.get('voidedAt'))} by "
            f"{_clean(invoice.get('voidedByUsername'))}: {_clean(invoice.get('voidReason'))}"
        )
    if not notes:
        return
    lines: list[str] = []
    for note in notes:
        lines.extend(_wrap_text(note, RIGHT - LEFT, 8.5))
    layout.ensure(35 + len(lines) * 11)
    layout.section("Notes")
    for line in lines:
        layout.canvas.text(LEFT, layout.y, line, 8.5)
        layout.y -= 11


def render_invoice_pdf(invoice: dict[str, Any], generated_at: str = "") -> bytes:
    invoice_number = _clean(invoice.get("invoiceNumber"), "Invoice")
    customer = invoice.get("customer") or {}
    canvas = _PdfCanvas()
    layout = _InvoiceLayout(canvas, invoice_number)
    layout.first_page()

    status = _clean(invoice.get("status")).replace("_", " ").upper()
    status_color = (
        DANGER
        if status in {"VOID", "OVERDUE"}
        else WARNING
        if status in {"DRAFT", "ISSUED", "PARTIALLY PAID"}
        else ACCENT
    )
    canvas.right_text(RIGHT, 773, status, 11, bold=True, color=status_color)
    canvas.right_text(RIGHT, 752, _clean(invoice.get("invoiceType")).replace("_", " ").title(), 8, color=MUTED)

    canvas.text(LEFT, layout.y, "BILL TO", 8, bold=True, color=MUTED)
    canvas.text(318, layout.y, "INVOICE DETAILS", 8, bold=True, color=MUTED)
    left_y = layout.y - 19
    canvas.text(LEFT, left_y, _customer_name(customer), 11, bold=True)
    left_y -= 16
    if customer.get("accountNumber"):
        canvas.text(LEFT, left_y, f"Account: {_clean(customer.get('accountNumber'))}", 9)
        left_y -= 14
    if customer.get("contactNumber"):
        canvas.text(LEFT, left_y, f"Contact: {_clean(customer.get('contactNumber'))}", 9)
        left_y -= 14
    for address_line in _wrap_text(customer.get("address"), 235, 8.5):
        canvas.text(LEFT, left_y, address_line, 8.5, color=MUTED)
        left_y -= 12

    detail_y = layout.y - 19
    detail_rows = [
        ("Issue date", _date_label(invoice.get("issueDate"))),
        ("Due date", _date_label(invoice.get("dueDate"))),
        ("Billing period", _clean(invoice.get("billingPeriodLabel"))),
        (
            "Coverage",
            f"{_date_label(invoice.get('billingCycleStart'))} - {_date_label(invoice.get('billingCycleEnd'))}",
        ),
    ]
    for label, value in detail_rows:
        _draw_label_value(canvas, 318, detail_y, label, value, value_x=405)
        detail_y -= 16
    layout.y = min(left_y, detail_y) - 8

    first_line_item = (invoice.get("lineItems") or [{}])[0]
    service_values = [
        ("Plan", invoice.get("catalogName") or first_line_item.get("catalogName")),
        ("Service ID", invoice.get("serviceId")),
        ("Service account", invoice.get("serviceAccountNumber")),
        ("Billing mode", _clean(invoice.get("billingMode"), "").replace("_", " ").title()),
        ("Catalog code", invoice.get("catalogCode")),
        ("Service order", invoice.get("serviceOrderId")),
    ]
    service_values = [(label, value) for label, value in service_values if _clean(value, "")]
    if service_values:
        layout.section("Service details")
        for index in range(0, len(service_values), 2):
            layout.ensure(29)
            for offset, (label, value) in enumerate(service_values[index:index + 2]):
                x = LEFT if offset == 0 else 318
                canvas.text(x, layout.y, label.upper(), 7, bold=True, color=MUTED)
                lines = _wrap_text(value, 225, 9)
                canvas.text(x, layout.y - 13, lines[0], 9, bold=True)
            layout.y -= 30

    _render_account_summary(layout, invoice)
    _render_charges(layout, invoice)
    _render_adjustments(layout, invoice.get("adjustments") or [])
    _render_payments(layout, invoice.get("payments") or [])
    _render_summary(layout, invoice)
    _render_notes(layout, invoice)

    generated_label = _date_time_label(generated_at) if generated_at else _date_time_label(datetime.now().isoformat())
    for page_index in range(len(canvas.pages)):
        canvas.line(LEFT, 44, RIGHT, 44, width=0.5, page=page_index)
        canvas.text(
            LEFT,
            29,
            "Billing statement only. Payment receipts are issued separately.",
            7,
            color=MUTED,
            page=page_index,
        )
        canvas.right_text(
            RIGHT,
            29,
            f"Generated {generated_label} | Page {page_index + 1} of {len(canvas.pages)}",
            7,
            color=MUTED,
            page=page_index,
        )
    return canvas.to_bytes()
