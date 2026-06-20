"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import ActionButton from "@/components/ActionButton";
import { deleteModule, moveModule } from "@/actions/modules";

type ModuleRow = { id: string; title: string; videoCount: number };

export default function ModuleTable({ modules }: { modules: ModuleRow[] }) {
  if (modules.length === 0) {
    return <p className="empty-state">No modules configured yet.</p>;
  }
  const lastIdx = modules.length - 1;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Videos</th>
            <th>Reorder</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m, idx) => (
            <tr key={m.id}>
              <td>{idx + 1}</td>
              <td>
                <Link href={`/admin/modules/${m.id}`}>
                  <strong>{m.title}</strong>
                </Link>
              </td>
              <td>{m.videoCount}</td>
              <td>
                <div className="reorder-cluster">
                  <ActionButton action={() => moveModule(m.id, "top")} disabled={idx === 0} className="row-delete" title="Move to top">
                    <ChevronsUp size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveModule(m.id, "up")} disabled={idx === 0} className="row-delete" title="Move up">
                    <ArrowUp size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveModule(m.id, "down")} disabled={idx === lastIdx} className="row-delete" title="Move down">
                    <ArrowDown size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveModule(m.id, "bottom")} disabled={idx === lastIdx} className="row-delete" title="Move to bottom">
                    <ChevronsDown size={14} />
                  </ActionButton>
                </div>
              </td>
              <td className="row-actions">
                <Link className="row-btn" href={`/admin/modules/${m.id}`}>
                  <SquareArrowOutUpRight size={13} aria-hidden="true" />
                  Open
                </Link>
                <Link className="row-btn" href={`/admin/modules/${m.id}#edit`}>
                  <Pencil size={13} aria-hidden="true" />
                  Edit
                </Link>
                <ActionButton
                  action={() => deleteModule(m.id)}
                  successMessage={`Deleted “${m.title}”.`}
                  confirm={`Delete module “${m.title}”? Its videos and notes will be removed.`}
                  className="row-delete"
                  ariaLabel={`Delete ${m.title}`}
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
