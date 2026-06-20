"use client";

import { Trash2 } from "lucide-react";
import ActionButton from "@/components/ActionButton";
import { deleteNote, setNoteDownload } from "@/actions/notes";

type NoteRow = {
  id: string;
  title: string;
  kind: string;
  href: string | null;
  hrefLabel: string;
  downloadEnabled: boolean;
};

export default function NoteTable({ notes }: { notes: NoteRow[] }) {
  if (notes.length === 0) {
    return <p className="empty-state">No notes attached to this video yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Download Permission</th>
            <th aria-label="Delete"></th>
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => (
            <tr key={n.id}>
              <td>
                <strong>{n.title}</strong>
              </td>
              <td>
                {n.href ? (
                  <>
                    {n.kind} ·{" "}
                    <a href={n.href} target="_blank" rel="noreferrer">
                      {n.hrefLabel}
                    </a>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <ActionButton
                  action={() => setNoteDownload(n.id, !n.downloadEnabled)}
                  successMessage={
                    n.downloadEnabled ? "Download disabled." : "Download enabled."
                  }
                  className="pill-toggle"
                >
                  {n.downloadEnabled ? "Disable" : "Enable"} Download
                </ActionButton>
              </td>
              <td className="row-actions">
                <ActionButton
                  action={() => deleteNote(n.id)}
                  successMessage={`Deleted note “${n.title}”.`}
                  confirm={`Delete note “${n.title}”?`}
                  className="row-delete"
                  ariaLabel={`Delete ${n.title}`}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </ActionButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
