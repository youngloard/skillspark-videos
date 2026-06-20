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
import { deleteVideo, moveVideo } from "@/actions/videos";

type VideoRow = {
  id: string;
  title: string;
  status: string;
  duration: number | null;
  notesCount: number;
};

export default function VideoTable({
  videos,
  emptyLabel = "No videos uploaded yet.",
}: {
  videos: VideoRow[];
  emptyLabel?: string;
}) {
  if (videos.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }
  const lastIdx = videos.length - 1;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Status</th>
            <th>Notes</th>
            <th>Duration</th>
            <th>Reorder</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v, idx) => (
            <tr key={v.id}>
              <td>{idx + 1}</td>
              <td>
                <Link href={`/admin/videos/${v.id}`}>
                  <strong>{v.title}</strong>
                </Link>
              </td>
              <td>
                <span className="status-pill" data-tone={v.status === "active" ? undefined : "danger"}>
                  {v.status}
                </span>
              </td>
              <td>{v.notesCount}</td>
              <td>{v.duration ? `${v.duration}s` : "—"}</td>
              <td>
                <div className="reorder-cluster">
                  <ActionButton action={() => moveVideo(v.id, "top")} disabled={idx === 0} className="row-delete" title="Move to top">
                    <ChevronsUp size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveVideo(v.id, "up")} disabled={idx === 0} className="row-delete" title="Move up">
                    <ArrowUp size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveVideo(v.id, "down")} disabled={idx === lastIdx} className="row-delete" title="Move down">
                    <ArrowDown size={14} />
                  </ActionButton>
                  <ActionButton action={() => moveVideo(v.id, "bottom")} disabled={idx === lastIdx} className="row-delete" title="Move to bottom">
                    <ChevronsDown size={14} />
                  </ActionButton>
                </div>
              </td>
              <td className="row-actions">
                <Link className="row-btn" href={`/admin/videos/${v.id}`}>
                  <SquareArrowOutUpRight size={13} aria-hidden="true" />
                  Open
                </Link>
                <Link className="row-btn" href={`/admin/videos/${v.id}#edit`}>
                  <Pencil size={13} aria-hidden="true" />
                  Edit
                </Link>
                <ActionButton
                  action={() => deleteVideo(v.id)}
                  successMessage={`Deleted “${v.title}”.`}
                  confirm={`Delete video “${v.title}”? Its notes will be removed.`}
                  className="row-delete"
                  ariaLabel={`Delete ${v.title}`}
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
