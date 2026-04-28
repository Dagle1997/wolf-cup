/* GREENFIELD (NOT a Wolf Cup port). Wolf Cup's PDF artifacts (under
 * `reference/wolf-cup-marketing.html`, `reference/wolf-cup-admin-guide.html`,
 * etc.) are generated offline via shell-out to headless Chrome (see
 * `reference_pdf_generation.md` in the Claude memory; that file is NOT
 * runtime code). T4-3 ships a runtime PDF endpoint built fresh on
 * `pdfkit`. Decision dated 2026-04-28; pdfkit selected over puppeteer /
 * @react-pdf/renderer / Chrome-shell-out for container-friendliness +
 * deterministic byte output for snapshot tests. See PORTS.md.
 */

import PDFDocument from 'pdfkit';

export interface EventPdfFoursomeMember {
  name: string;
  /** USGA Handicap Index. NULL if no manual override AND no live fetch source. */
  handicapIndex: number | null;
  /** "GHIN linked: 1234567" (when ghin set) or null. */
  ghinLabel: string | null;
}

export interface EventPdfFoursome {
  foursomeNumber: number;
  members: EventPdfFoursomeMember[];
}

export interface EventPdfRound {
  roundNumber: number;
  /** Epoch ms — formatted as "May 7" inside the renderer. */
  roundDate: number;
  courseName: string;
  teeColor: string;
  foursomes: EventPdfFoursome[];
}

export interface EventPdfRosterEntry {
  name: string;
  handicapIndex: number | null;
  ghinLabel: string | null;
}

export interface EventPdfInput {
  event: {
    name: string;
    /** Epoch ms. */
    startDate: number;
    /** Epoch ms. */
    endDate: number;
    /** IANA timezone string (e.g., 'America/New_York'). */
    timezone: string;
  };
  rounds: EventPdfRound[];
  roster: EventPdfRosterEntry[];
}

/**
 * Format epoch ms as "May 7, 2026" using the event's timezone.
 * Returns the bare date with no day-of-week to keep the PDF compact.
 */
function formatDate(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(epochMs));
}

/**
 * Format handicap index for display: "12.5", "+2.1" (plus-handicap), "—" for null.
 */
function formatHandicap(hi: number | null): string {
  if (hi === null) return '—';
  if (hi < 0) return `+${Math.abs(hi).toFixed(1)}`;
  return hi.toFixed(1);
}

/**
 * Renders an event-schedule PDF as a Buffer. Pure function over input
 * data — no DB, no env, no I/O. Same input + frozen creation date →
 * byte-for-byte identical output.
 *
 * Layout: letter paper, 0.75-inch margins. Header band at top with
 * event name + date range + timezone. Per-round sections below. Roster
 * table at the end. Page breaks happen naturally when content overflows.
 */
export async function renderEventPdf(input: EventPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title: `${input.event.name} — Schedule`,
      // Freeze CreationDate for snapshot determinism. pdfkit defaults
      // to `new Date()` which would change every call.
      CreationDate: new Date(0),
    },
  });

  // Collect chunks into a Buffer.
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ---- Header band ------------------------------------------------------
  doc.fontSize(20).font('Helvetica-Bold').text(input.event.name, { align: 'center' });
  doc.moveDown(0.3);

  const dateRange =
    input.event.startDate === input.event.endDate
      ? formatDate(input.event.startDate, input.event.timezone)
      : `${formatDate(input.event.startDate, input.event.timezone)} – ${formatDate(input.event.endDate, input.event.timezone)}`;
  doc.fontSize(11).font('Helvetica').text(dateRange, { align: 'center' });
  doc.fontSize(9).fillColor('#666').text(input.event.timezone, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(1);

  // ---- Per-round sections ----------------------------------------------
  for (const round of input.rounds) {
    doc.moveDown(0.5);
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(
        `Round ${round.roundNumber} — ${formatDate(round.roundDate, input.event.timezone)}`,
      );
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#444')
      .text(`${round.courseName} • ${round.teeColor} tees`);
    doc.fillColor('#000');
    doc.moveDown(0.3);

    for (const foursome of round.foursomes) {
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(`Foursome ${foursome.foursomeNumber}`);
      doc.font('Helvetica').fontSize(10);
      for (const m of foursome.members) {
        const hiPart = ` (${formatHandicap(m.handicapIndex)})`;
        const ghinPart = m.ghinLabel ? ` — ${m.ghinLabel}` : '';
        doc.text(`  • ${m.name}${hiPart}${ghinPart}`);
      }
      doc.moveDown(0.2);
    }
  }

  // ---- Roster table ----------------------------------------------------
  if (input.roster.length > 0) {
    doc.moveDown(0.8);
    doc.fontSize(14).font('Helvetica-Bold').text('Roster');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    for (const r of input.roster) {
      const ghinPart = r.ghinLabel ? ` — ${r.ghinLabel}` : '';
      doc.text(`${r.name} (${formatHandicap(r.handicapIndex)})${ghinPart}`);
    }
  }

  // CRITICAL: attach the terminal listeners BEFORE calling doc.end().
  // pdfkit may emit 'end' synchronously during doc.end() in some Node
  // versions; attaching afterward could miss it and hang forever.
  // (Party-codex round-1 catch.)
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));
  });
  doc.end();
  return result;
}
