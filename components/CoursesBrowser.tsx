"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Search, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import ActionButton from "@/components/ActionButton";
import { deleteCourse } from "@/actions/courses";

type CourseRow = {
  id: string;
  name: string;
  layout: string;
  status: string;
  moduleCount: number;
  videoCount: number;
};

export default function CoursesBrowser({ courses }: { courses: CourseRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.layout.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q),
    );
  }, [courses, query]);

  return (
    <div className="browser">
      <div className="browser-toolbar">
        <h2>All courses</h2>
        <div className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses by name, layout, or status…"
            aria-label="Search courses"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {courses.length === 0
            ? "No courses created yet."
            : `No courses match “${query}”.`}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Layout</th>
                <th>Status</th>
                <th>Children</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.layout}</td>
                  <td>
                    <span
                      className="status-pill"
                      data-tone={c.status === "active" ? undefined : "danger"}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.layout === "module"
                      ? `${c.moduleCount} module(s)`
                      : `${c.videoCount} video(s)`}
                  </td>
                  <td className="row-actions">
                    <Link className="row-btn" href={`/admin/courses/${c.id}`}>
                      <SquareArrowOutUpRight size={13} aria-hidden="true" />
                      Open
                    </Link>
                    <Link className="row-btn" href={`/admin/courses/${c.id}#edit`}>
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </Link>
                    <ActionButton
                      action={() => deleteCourse(c.id)}
                      successMessage={`Deleted “${c.name}”.`}
                      confirm={`Delete “${c.name}”? This removes its modules, videos, and notes, and revokes student access.`}
                      className="row-delete"
                      ariaLabel={`Delete ${c.name}`}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
