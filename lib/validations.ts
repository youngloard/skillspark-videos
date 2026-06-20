import { z } from "zod";
import { parseDriveFileId } from "@/lib/drive";

export const idSchema = z.string().min(1).max(64);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(255);

export const studentCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "studentCode must be alphanumeric/_/-");

export const dateSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !isNaN(d.getTime()), "invalid date");

const idsArraySchema = z
  .union([z.array(idSchema), idSchema])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(z.array(idSchema))
  .optional()
  .default([]);

/**
 * batchCode (optional, free text):
 *   - empty / null / undefined  →  no batch assignment
 *   - matches an existing batchCode  →  use it
 *   - new code  →  the action auto-creates the batch on submit
 * batchId still accepted for any caller that already resolved the ID itself.
 * If both are provided, batchCode wins.
 *
 * Pre-process step normalizes the input: strings get trimmed, empty/whitespace
 * becomes null. That way an empty form field round-trips as "no batch" without
 * tripping the regex (which requires the un-trimmed string to be either empty
 * or a valid code).
 */
const batchCodeInputSchema = z
  .preprocess(
    (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    },
    z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9 _-]+$/, "batchCode must be alphanumeric/space/_/-")
      .nullable(),
  )
  .optional();

export const studentCreateSchema = z
  .object({
    studentCode: studentCodeSchema,
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    batchId: z.string().min(1).max(64).nullish(),
    batchCode: batchCodeInputSchema,
    accessStartDate: dateSchema,
    accessEndDate: dateSchema,
    courseIds: idsArraySchema,
    packageIds: idsArraySchema,
  })
  .refine((s) => s.accessEndDate >= s.accessStartDate, {
    path: ["accessEndDate"],
    message: "accessEndDate must be on/after accessStartDate",
  });

export const studentUpdateSchema = z
  .object({
    studentCode: studentCodeSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    email: emailSchema.optional(),
    batchId: z.string().min(1).max(64).nullish(),
    batchCode: batchCodeInputSchema,
    status: z.enum(["active", "blocked"]).optional(),
    accessStartDate: dateSchema.optional(),
    accessEndDate: dateSchema.optional(),
  })
  .refine(
    (s) =>
      !(s.accessStartDate && s.accessEndDate) ||
      s.accessEndDate! >= s.accessStartDate!,
    { path: ["accessEndDate"], message: "accessEndDate must be on/after accessStartDate" },
  );

/** Diff submitted from the student edit form: which courses/packages should be enrolled? */
export const studentEnrollmentsSchema = z.object({
  studentId: idSchema,
  courseIds: idsArraySchema,
  packageIds: idsArraySchema,
});

export const batchSchema = z.object({
  batchCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9 _-]+$/, "batchCode must be alphanumeric/space/_/-"),
  batchName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  courseIds: idsArraySchema,
  packageIds: idsArraySchema,
});

export const batchEnrollmentsSchema = z.object({
  batchId: idSchema,
  courseIds: idsArraySchema,
  packageIds: idsArraySchema,
});

const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url("imageUrl must be a valid URL")
  .optional()
  .or(z.literal(""));

export const packageSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: imageUrlSchema,
  status: z.enum(["active", "inactive"]).default("active"),
  courseIds: idsArraySchema,
});

export const packageCoursesSchema = z.object({
  packageId: idSchema,
  courseIds: idsArraySchema,
});

export const courseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: imageUrlSchema,
  status: z.enum(["active", "inactive"]).default("active"),
  /** "module" → course → modules → videos. "flat" → course → videos directly. */
  layout: z.enum(["module", "flat"]).default("module"),
});

export const moduleSchema = z.object({
  courseId: idSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  moduleOrder: z.coerce.number().int().min(0).default(0),
});

/**
 * Video input — admin pastes any Drive URL/ID; we transform to canonical fileId.
 * Exactly one of moduleId / courseId must be set (depending on the parent course's layout).
 */
export const videoSchema = z
  .object({
    moduleId: idSchema.optional(),
    courseId: idSchema.optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    driveFileId: z
      .string()
      .trim()
      .min(1, "Drive link or ID is required")
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID from input",
          });
          return z.NEVER;
        }
        return id;
      }),
    videoOrder: z.coerce.number().int().min(0).default(0),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .refine((v) => !!v.moduleId !== !!v.courseId, {
    path: ["moduleId"],
    message: "provide exactly one of moduleId or courseId",
  });

// Update form: any field can change but the moduleId/courseId pair, if present,
// must still pass the "exactly one" rule.
export const videoUpdateSchema = z
  .object({
    moduleId: idSchema.optional(),
    courseId: idSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    driveFileId: z
      .string()
      .trim()
      .min(1)
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID from input",
          });
          return z.NEVER;
        }
        return id;
      })
      .optional(),
    videoOrder: z.coerce.number().int().min(0).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  });

const noteCommon = z.object({
  videoId: idSchema,
  title: z.string().trim().min(1).max(200),
  downloadEnabled: z.coerce.boolean().default(false),
});

/**
 * Note input — discriminated by sourceType. Pastable Drive link runs through
 * parseDriveFileId. External URL must be https. Upload arrives via FormData
 * and is validated separately at the action layer (this schema covers metadata).
 */
export const noteSchema = z.discriminatedUnion("sourceType", [
  noteCommon.extend({
    sourceType: z.literal("drive"),
    driveInput: z
      .string()
      .trim()
      .min(1, "Drive link or ID is required")
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID",
          });
          return z.NEVER;
        }
        return id;
      }),
  }),
  noteCommon.extend({
    sourceType: z.literal("url"),
    externalUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https:\/\//i.test(u), "URL must use https"),
  }),
  noteCommon.extend({
    sourceType: z.literal("upload"),
    // Uploads are handled outside Zod (File via FormData); just gate the marker.
  }),
]);

export const enrollmentAssignSchema = z.object({
  studentId: idSchema.optional(),
  batchId: idSchema.optional(),
  courseId: idSchema.optional(),
  packageId: idSchema.optional(),
});

export const progressSchema = z.object({
  videoId: idSchema,
  lastTimestamp: z.coerce.number().int().min(0).max(60 * 60 * 24),
  completed: z.coerce.boolean().optional(),
});

/** Bulk action over selected students from the admin search page. */
export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("revoke_course"),
    studentIds: z.array(idSchema).min(1),
    courseId: idSchema,
  }),
  z.object({
    action: z.literal("revoke_package"),
    studentIds: z.array(idSchema).min(1),
    packageId: idSchema,
  }),
  z.object({
    action: z.literal("deny_course"),
    studentIds: z.array(idSchema).min(1),
    courseId: idSchema,
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("undeny_course"),
    studentIds: z.array(idSchema).min(1),
    courseId: idSchema,
  }),
  z.object({
    action: z.literal("block"),
    studentIds: z.array(idSchema).min(1),
  }),
  z.object({
    action: z.literal("activate"),
    studentIds: z.array(idSchema).min(1),
  }),
  z.object({
    action: z.literal("set_end_date"),
    studentIds: z.array(idSchema).min(1),
    endDate: dateSchema,
  }),
]);
