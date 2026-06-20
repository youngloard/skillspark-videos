"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, UserPlus } from "lucide-react";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import BatchCodeCombobox from "@/components/BatchCodeCombobox";
import { useToast } from "@/components/Toast";
import {
  createStudentFormAction,
  type StudentFormState,
} from "@/actions/students";

type Batch = { id: string; batchCode: string; batchName: string };
type NamedRef = { id: string; name: string };

type Props = {
  batches: Batch[];
  courses: NamedRef[];
  packages: NamedRef[];
  /** Sensible defaults so the date fields don't trip the browser's
   *  `required` check on an empty submit. */
  defaultStartDate: string; // YYYY-MM-DD
  defaultEndDate: string;
};

const INITIAL: StudentFormState = { ok: true };

export default function StudentAddForm({
  batches,
  courses,
  packages,
  defaultStartDate,
  defaultEndDate,
}: Props) {
  const [state, formAction, pending] = useActionState(
    createStudentFormAction,
    INITIAL,
  );
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  // After a successful submit, reset the form so the next student starts
  // from a clean slate, and fire a global success toast.
  const lastSubmittedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.ok || !state.submittedAt) return;
    if (state.submittedAt === lastSubmittedAt.current) return;
    lastSubmittedAt.current = state.submittedAt;
    formRef.current?.reset();
    toast.success("Student added successfully.");
  }, [state, toast]);

  return (
    <details id="add-student" className="add-student-panel" open>
      <summary>
        <UserPlus size={16} aria-hidden="true" />
        <span>Add a new student</span>
      </summary>
      <p>Pick courses and/or packages to assign at the same time.</p>

      {state.error && (
        <div className="form-banner form-banner-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            <strong>Couldn&rsquo;t create the student.</strong> {state.error}
          </span>
        </div>
      )}

      <form ref={formRef} action={formAction}>
        <div className="form-grid">
          <div className="form-field-group">
            <label>
              Student Code
              <input name="studentCode" placeholder="e.g. STU101" required />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Full Name
              <input name="name" placeholder="e.g. John Doe" required />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Email Address
              <input
                name="email"
                placeholder="e.g. john@spark.com"
                type="email"
                required
              />
            </label>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-field-group">
            <label>
              Batch Code
              <BatchCodeCombobox
                name="batchCode"
                options={batches.map((b) => ({
                  code: b.batchCode,
                  name: b.batchName,
                }))}
                hint="Pick an existing batch from the list or type a new code — new ones are auto-created on save. Leave blank for no batch."
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Access Start Date
              <input
                name="accessStartDate"
                type="date"
                defaultValue={defaultStartDate}
                required
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Access End Date
              <input
                name="accessEndDate"
                type="date"
                defaultValue={defaultEndDate}
                required
              />
            </label>
          </div>
        </div>

        <div className="pickers-grid">
          <MultiCheckPicker
            name="courseIds"
            legend="Courses (direct)"
            items={courses.map((c) => ({ id: c.id, label: c.name }))}
            placeholder="Search courses…"
          />
          <MultiCheckPicker
            name="packageIds"
            legend="Packages (direct)"
            items={packages.map((p) => ({ id: p.id, label: p.name }))}
            placeholder="Search packages…"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create student account"}
          </button>
        </div>
      </form>
    </details>
  );
}
