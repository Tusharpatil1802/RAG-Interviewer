from __future__ import annotations

from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _text(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value if item) or "-"
    return str(value).strip() or "-"


def _paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(_text(text)).replace("\n", "<br/>"), style)


def _labeled_paragraph(label: str, value, style: ParagraphStyle) -> Paragraph:
    safe_value = escape(_text(value)).replace("\n", "<br/>")
    return Paragraph(f"<b>{escape(label)}:</b> {safe_value}", style)


def _format_datetime(value: datetime | None) -> str:
    if not value:
        return "-"
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _average_score(turns: list) -> str:
    scores = []
    for turn in turns:
        evaluation = turn.evaluation or {}
        score = evaluation.get("score")
        if isinstance(score, (int, float)):
            scores.append(score)
    if not scores:
        return "-"
    return f"{sum(scores) / len(scores):.1f} / 10"


def build_session_report_pdf(session, max_turns: int) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=0.65 * inch,
        rightMargin=0.65 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#172033"),
        alignment=TA_LEFT,
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "SectionTitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#1d4ed8"),
        spaceBefore=10,
        spaceAfter=8,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor("#172033"),
        spaceAfter=6,
    )
    label_style = ParagraphStyle(
        "Label",
        parent=body_style,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#334155"),
    )
    small_style = ParagraphStyle(
        "Small",
        parent=body_style,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#526071"),
    )

    completed_turns = sorted([turn for turn in session.turns if turn.answer], key=lambda turn: turn.id)
    profile = session.extracted_profile or {}

    story = [
        _paragraph("RoleRAG Interview Report", title_style),
        _paragraph(
            f"Candidate-focused interview summary for the role {session.role}. "
            "This report captures profile extraction, turn-by-turn answers, evaluations, and the final interview summary.",
            body_style,
        ),
        Spacer(1, 8),
    ]

    metadata = Table(
        [
            [
                _paragraph("Candidate", label_style),
                _paragraph(profile.get("name") or session.candidate_name or "Unknown", body_style),
                _paragraph("Role", label_style),
                _paragraph(session.role, body_style),
            ],
            [
                _paragraph("Created", label_style),
                _paragraph(_format_datetime(session.created_at), body_style),
                _paragraph("Completed Turns", label_style),
                _paragraph(f"{len(completed_turns)} / {max_turns}", body_style),
            ],
            [
                _paragraph("Average Score", label_style),
                _paragraph(_average_score(completed_turns), body_style),
                _paragraph("Domains", label_style),
                _paragraph(_text(profile.get("domains")), body_style),
            ],
        ],
        colWidths=[1.15 * inch, 2.1 * inch, 1.2 * inch, 2.1 * inch],
    )
    metadata.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fbff")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d7dfeb")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d7dfeb")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([metadata, Spacer(1, 14)])

    story.append(_paragraph("Extracted Candidate Profile", section_style))
    story.append(_labeled_paragraph("Skills", profile.get("skills"), body_style))
    story.append(_labeled_paragraph("Experience", profile.get("years_experience") or profile.get("seniority_signal"), body_style))
    story.append(_labeled_paragraph("Project Highlights", profile.get("projects"), body_style))
    story.append(_labeled_paragraph("Summary", profile.get("summary"), body_style))

    story.append(_paragraph("Final Interview Summary", section_style))
    story.append(_paragraph(session.summary or "Summary is not available yet for this session.", body_style))

    story.append(_paragraph("Turn-by-Turn Results", section_style))
    if not completed_turns:
        story.append(_paragraph("No completed interview turns were available when this report was generated.", body_style))
    else:
        for index, turn in enumerate(completed_turns, start=1):
            evaluation = turn.evaluation or {}
            sources = [item.get("metadata", {}).get("source") for item in (turn.retrieved_context or []) if item.get("metadata", {}).get("source")]

            story.append(_paragraph(f"Turn {index}", section_style))
            story.append(_labeled_paragraph("Question", turn.question, body_style))
            story.append(_labeled_paragraph("Answer", turn.answer, body_style))
            story.append(_labeled_paragraph("Score", evaluation.get("score"), body_style))
            story.append(_labeled_paragraph("Strengths", evaluation.get("strengths"), body_style))
            story.append(_labeled_paragraph("Gaps", evaluation.get("gaps"), body_style))
            story.append(_labeled_paragraph("Suggested Follow-up", evaluation.get("follow_up"), body_style))
            story.append(_labeled_paragraph("Grounding Sources", sources, small_style))
            story.append(Spacer(1, 6))

    story.append(Spacer(1, 8))
    story.append(_paragraph("Generated by RoleRAG Interviewer", small_style))

    doc.build(story)
    return buffer.getvalue()
