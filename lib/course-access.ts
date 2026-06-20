import { prisma } from "@/lib/db";

export type AccessSource =
  | "direct_course"
  | "direct_package"
  | "batch_course"
  | "batch_package"
  | "denied";

export type DashboardSection = "package" | "individual";

async function getDeniedCourseIds(studentId: string): Promise<Set<string>> {
  const rows = await prisma.studentCourseDenial.findMany({
    where: { studentId },
    select: { courseId: true },
  });
  return new Set(rows.map((r) => r.courseId));
}

/**
 * Returns all unique active courses a student can access via any path,
 * minus any courses on the student's denial list:
 *   1. Direct course assignment
 *   2. Direct package assignment (course inside package)
 *   3. Batch course assignment
 *   4. Batch package assignment
 * Filters out inactive courses. Does NOT check student status/expiry — caller must.
 */
export async function getAccessibleCourses(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, batchId: true },
  });
  if (!student) return [];

  // All four grant-path queries + denial fetch run concurrently. Saves ~3
  // sequential RTTs on every dashboard load.
  const [direct, direct_pkg, batchCourse, batchPkg, denialRows] = await Promise.all([
    prisma.studentCourse.findMany({
      where: { studentId },
      select: { courseId: true },
    }),
    prisma.studentPackage.findMany({
      where: { studentId },
      select: {
        package: {
          select: {
            status: true,
            packageCourses: { select: { courseId: true } },
          },
        },
      },
    }),
    student.batchId
      ? prisma.batchCourse.findMany({
          where: { batchId: student.batchId },
          select: { courseId: true },
        })
      : Promise.resolve([] as { courseId: string }[]),
    student.batchId
      ? prisma.batchPackage.findMany({
          where: { batchId: student.batchId },
          select: {
            package: {
              select: {
                status: true,
                packageCourses: { select: { courseId: true } },
              },
            },
          },
        })
      : Promise.resolve([] as Array<{
          package: { status: string; packageCourses: { courseId: string }[] } | null;
        }>),
    prisma.studentCourseDenial.findMany({
      where: { studentId },
      select: { courseId: true },
    }),
  ]);

  const ids = new Set<string>();
  direct.forEach((r) => ids.add(r.courseId));
  for (const r of direct_pkg) {
    if (r.package?.status === "active") {
      r.package.packageCourses.forEach((pc) => ids.add(pc.courseId));
    }
  }
  batchCourse.forEach((r) => ids.add(r.courseId));
  for (const r of batchPkg) {
    if (r.package?.status === "active") {
      r.package.packageCourses.forEach((pc) => ids.add(pc.courseId));
    }
  }

  if (ids.size === 0) return [];

  const denied = new Set(denialRows.map((d) => d.courseId));
  const finalIds = [...ids].filter((id) => !denied.has(id));
  if (finalIds.length === 0) return [];

  return prisma.course.findMany({
    where: { id: { in: finalIds }, status: "active" },
    orderBy: { name: "asc" },
  });
}

export async function isCourseDenied(studentId: string, courseId: string): Promise<boolean> {
  const row = await prisma.studentCourseDenial.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true },
  });
  return !!row;
}

export async function canAccessCourse(studentId: string, courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true },
  });
  if (!course || course.status !== "active") return false;

  // Hard-block via denial first.
  if (await isCourseDenied(studentId, courseId)) return false;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { batchId: true },
  });
  if (!student) return false;

  // 1. Direct course
  if (
    await prisma.studentCourse.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { id: true },
    })
  ) {
    return true;
  }

  // 2. Direct package containing course (package must be active)
  const directPkg = await prisma.studentPackage.findFirst({
    where: {
      studentId,
      package: {
        status: "active",
        packageCourses: { some: { courseId } },
      },
    },
    select: { id: true },
  });
  if (directPkg) return true;

  if (!student.batchId) return false;

  // 3. Batch course
  const batchCourse = await prisma.batchCourse.findUnique({
    where: { batchId_courseId: { batchId: student.batchId, courseId } },
    select: { id: true },
  });
  if (batchCourse) return true;

  // 4. Batch package containing course
  const batchPkg = await prisma.batchPackage.findFirst({
    where: {
      batchId: student.batchId,
      package: {
        status: "active",
        packageCourses: { some: { courseId } },
      },
    },
    select: { id: true },
  });
  return !!batchPkg;
}

/**
 * Returns student IDs that have access to a given course via ANY path.
 * Excludes students with an active denial for the course.
 * Used by admin filtering (e.g. "show all Excel students").
 */
export async function getStudentsWithCourseAccess(courseId: string): Promise<string[]> {
  const ids = new Set<string>();

  // Direct course
  (
    await prisma.studentCourse.findMany({
      where: { courseId },
      select: { studentId: true },
    })
  ).forEach((r) => ids.add(r.studentId));

  // Direct package containing course
  (
    await prisma.studentPackage.findMany({
      where: {
        package: {
          status: "active",
          packageCourses: { some: { courseId } },
        },
      },
      select: { studentId: true },
    })
  ).forEach((r) => ids.add(r.studentId));

  const directBatchIds = (
    await prisma.batchCourse.findMany({
      where: { courseId },
      select: { batchId: true },
    })
  ).map((r) => r.batchId);

  const pkgBatchIds = (
    await prisma.batchPackage.findMany({
      where: {
        package: {
          status: "active",
          packageCourses: { some: { courseId } },
        },
      },
      select: { batchId: true },
    })
  ).map((r) => r.batchId);

  const batchIds = [...new Set([...directBatchIds, ...pkgBatchIds])];
  if (batchIds.length > 0) {
    (
      await prisma.student.findMany({
        where: { batchId: { in: batchIds } },
        select: { id: true },
      })
    ).forEach((s) => ids.add(s.id));
  }

  // Subtract denials.
  const denials = await prisma.studentCourseDenial.findMany({
    where: { courseId, studentId: { in: [...ids] } },
    select: { studentId: true },
  });
  for (const d of denials) ids.delete(d.studentId);

  return [...ids];
}

export type DashboardCourse = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  layout: string;
};

export type DashboardPackage = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Number of accessible (active, not denied) courses inside this package. */
  accessibleCourseCount: number;
  /** Sources through which the student got this package. */
  via: ("direct" | "batch")[];
};

/**
 * Returns the student's package list and the individual-only course list for
 * the dashboard.
 *
 *   packages          — packages the student holds (direct or batch). Each
 *                       carries an accessible-course count (active, not denied).
 *   individualCourses — courses granted via direct course or batch course
 *                       paths AND not present in any of the student's packages
 *                       (so we don't double-list a course that's also under
 *                       one of the packages above).
 */
export async function getDashboard(studentId: string): Promise<{
  packages: DashboardPackage[];
  individualCourses: DashboardCourse[];
}> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { batchId: true },
  });
  if (!student) return { packages: [], individualCourses: [] };

  const [directPkgRows, batchPkgRows, denialRows] = await Promise.all([
    prisma.studentPackage.findMany({
      where: { studentId, package: { status: "active" } },
      select: {
        package: {
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            packageCourses: {
              where: { course: { status: "active" } },
              select: { courseId: true },
            },
          },
        },
      },
    }),
    student.batchId
      ? prisma.batchPackage.findMany({
          where: { batchId: student.batchId, package: { status: "active" } },
          select: {
            package: {
              select: {
                id: true,
                name: true,
                description: true,
                imageUrl: true,
                packageCourses: {
                  where: { course: { status: "active" } },
                  select: { courseId: true },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.studentCourseDenial.findMany({
      where: { studentId },
      select: { courseId: true },
    }),
  ]);

  const denied = new Set(denialRows.map((d) => d.courseId));

  // Dedupe packages by id; merge `via` paths.
  const pkgMap = new Map<string, DashboardPackage & { courseIds: string[] }>();
  function add(
    pkg: {
      id: string;
      name: string;
      description: string | null;
      imageUrl: string | null;
      packageCourses: { courseId: string }[];
    },
    source: "direct" | "batch",
  ) {
    const courseIds = pkg.packageCourses.map((pc) => pc.courseId);
    const existing = pkgMap.get(pkg.id);
    if (existing) {
      if (!existing.via.includes(source)) existing.via.push(source);
      return;
    }
    const accessibleCourseCount = courseIds.filter((id) => !denied.has(id)).length;
    pkgMap.set(pkg.id, {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      imageUrl: pkg.imageUrl,
      accessibleCourseCount,
      via: [source],
      courseIds,
    });
  }
  for (const r of directPkgRows) if (r.package) add(r.package, "direct");
  for (const r of batchPkgRows) if (r.package) add(r.package, "batch");

  const packages: DashboardPackage[] = [...pkgMap.values()]
    .map(({ courseIds: _omit, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Course IDs reachable via any of the student's packages — we'll exclude
  // these from the "individual courses" bucket.
  const inPackageIds = new Set<string>();
  for (const dp of pkgMap.values()) {
    for (const id of dp.courseIds) inPackageIds.add(id);
  }

  const accessible = await getAccessibleCourses(studentId);
  const individualCourses: DashboardCourse[] = accessible
    .filter((c) => !inPackageIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: (c as { imageUrl?: string | null }).imageUrl ?? null,
      layout: c.layout,
    }));

  return { packages, individualCourses };
}

/**
 * Path filters for advanced search. The filter is applied AFTER we've already
 * confirmed the student has access to the course at all (so getAccessibleCourses
 * deduplication and denial checks still apply).
 */
export type CoursePathFilter =
  | "any"
  | "via_direct_course"      // has a direct StudentCourse row
  | "via_direct_package"     // has a StudentPackage row whose package contains the course
  | "via_batch_course"       // batch has a BatchCourse for the course
  | "via_batch_package"      // batch has a BatchPackage whose package contains the course
  | "not_via_direct_package" // has access, but no direct package contains it
  | "not_via_any_package"    // has access, but no package (direct or batch) contains it
  | "only_direct_course"     // sources == ["direct_course"]
  | "only_via_batch";        // sources subset of {batch_course, batch_package}

function matchesPathFilter(
  sources: AccessSource[],
  filter: CoursePathFilter,
): boolean {
  if (sources.includes("denied")) return false;
  if (filter === "any") return true;
  const has = (s: AccessSource) => sources.includes(s);
  if (filter === "via_direct_course") return has("direct_course");
  if (filter === "via_direct_package") return has("direct_package");
  if (filter === "via_batch_course") return has("batch_course");
  if (filter === "via_batch_package") return has("batch_package");
  if (filter === "not_via_direct_package") return !has("direct_package");
  if (filter === "not_via_any_package") return !has("direct_package") && !has("batch_package");
  if (filter === "only_direct_course") {
    return sources.length === 1 && has("direct_course");
  }
  if (filter === "only_via_batch") {
    return sources.length > 0 && sources.every((s) => s === "batch_course" || s === "batch_package");
  }
  return true;
}

/**
 * Filters a list of studentIds (already confirmed to have access to courseId)
 * down to those whose access path matches the given filter.
 *
 * Batched implementation: one set of parallel queries for the entire student
 * list, then in-memory filtering. Previous version called
 * `getStudentAccessSources` per student (O(N) sequential roundtrips); this
 * version is O(1) roundtrip-clusters regardless of N.
 */
export async function filterStudentsByCoursePath(
  studentIds: string[],
  courseId: string,
  filter: CoursePathFilter,
): Promise<string[]> {
  if (filter === "any" || studentIds.length === 0) return studentIds;
  const sourceMap = await getStudentAccessSourcesBatch(studentIds, courseId);
  const out: string[] = [];
  for (const sid of studentIds) {
    const sources = sourceMap.get(sid) ?? [];
    if (matchesPathFilter(sources, filter)) out.push(sid);
  }
  return out;
}

/**
 * Batched variant of `getStudentAccessSources` for many students at once.
 * Returns a map of studentId → sources. Students absent from the map have
 * empty sources (no access via any path).
 */
export async function getStudentAccessSourcesBatch(
  studentIds: string[],
  courseId: string,
): Promise<Map<string, AccessSource[]>> {
  const result = new Map<string, AccessSource[]>();
  if (studentIds.length === 0) return result;

  // Denials trump everything.
  const denials = await prisma.studentCourseDenial.findMany({
    where: { courseId, studentId: { in: studentIds } },
    select: { studentId: true },
  });
  const deniedSet = new Set(denials.map((d) => d.studentId));
  for (const sid of deniedSet) result.set(sid, ["denied"]);

  const remaining = studentIds.filter((sid) => !deniedSet.has(sid));
  if (remaining.length === 0) return result;

  // Run direct + students-with-batch lookups concurrently. The batch-grant
  // queries depend on the resulting batchIds, so they run in a second wave.
  const [directCourse, directPackage, students] = await Promise.all([
    prisma.studentCourse.findMany({
      where: { courseId, studentId: { in: remaining } },
      select: { studentId: true },
    }),
    prisma.studentPackage.findMany({
      where: {
        studentId: { in: remaining },
        package: { status: "active", packageCourses: { some: { courseId } } },
      },
      select: { studentId: true },
    }),
    prisma.student.findMany({
      where: { id: { in: remaining }, batchId: { not: null } },
      select: { id: true, batchId: true },
    }),
  ]);

  const batchIds = [...new Set(students.map((s) => s.batchId).filter((b): b is string => !!b))];
  const [batchCourse, batchPackage] = await Promise.all([
    batchIds.length
      ? prisma.batchCourse.findMany({
          where: { courseId, batchId: { in: batchIds } },
          select: { batchId: true },
        })
      : Promise.resolve([] as { batchId: string }[]),
    batchIds.length
      ? prisma.batchPackage.findMany({
          where: {
            batchId: { in: batchIds },
            package: { status: "active", packageCourses: { some: { courseId } } },
          },
          select: { batchId: true },
        })
      : Promise.resolve([] as { batchId: string }[]),
  ]);

  const directCourseSet = new Set(directCourse.map((r) => r.studentId));
  const directPackageSet = new Set(directPackage.map((r) => r.studentId));
  const batchHasCourse = new Set(batchCourse.map((r) => r.batchId));
  const batchHasPackage = new Set(batchPackage.map((r) => r.batchId));
  const studentBatch = new Map(students.map((s) => [s.id, s.batchId!]));

  for (const sid of remaining) {
    const sources: AccessSource[] = [];
    if (directCourseSet.has(sid)) sources.push("direct_course");
    if (directPackageSet.has(sid)) sources.push("direct_package");
    const batchId = studentBatch.get(sid);
    if (batchId) {
      if (batchHasCourse.has(batchId)) sources.push("batch_course");
      if (batchHasPackage.has(batchId)) sources.push("batch_package");
    }
    if (sources.length) result.set(sid, sources);
  }

  return result;
}

/**
 * Inverse of getStudentAccessSourcesBatch: one student × many courses.
 * Computes the source list per courseId in a fixed handful of parallel
 * queries — replaces the N×5 sequential pattern that was making the admin
 * student-edit page slow on catalogs with many courses.
 */
export async function getCourseSourcesForStudent(
  studentId: string,
  courseIds: string[],
): Promise<Map<string, AccessSource[]>> {
  const result = new Map<string, AccessSource[]>();
  if (courseIds.length === 0) return result;
  const courseSet = new Set(courseIds);

  // One read of the student row up front for batchId.
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { batchId: true },
  });
  if (!student) {
    for (const id of courseIds) result.set(id, []);
    return result;
  }

  // Five parallel reads cover every grant path.
  const [denials, directCourses, directPackageRows, batchCourses, batchPackageRows] = await Promise.all([
    prisma.studentCourseDenial.findMany({
      where: { studentId, courseId: { in: courseIds } },
      select: { courseId: true },
    }),
    prisma.studentCourse.findMany({
      where: { studentId, courseId: { in: courseIds } },
      select: { courseId: true },
    }),
    prisma.studentPackage.findMany({
      where: {
        studentId,
        package: { status: "active", packageCourses: { some: { courseId: { in: courseIds } } } },
      },
      select: {
        package: {
          select: { packageCourses: { select: { courseId: true } } },
        },
      },
    }),
    student.batchId
      ? prisma.batchCourse.findMany({
          where: { batchId: student.batchId, courseId: { in: courseIds } },
          select: { courseId: true },
        })
      : Promise.resolve([] as { courseId: string }[]),
    student.batchId
      ? prisma.batchPackage.findMany({
          where: {
            batchId: student.batchId,
            package: { status: "active", packageCourses: { some: { courseId: { in: courseIds } } } },
          },
          select: {
            package: {
              select: { packageCourses: { select: { courseId: true } } },
            },
          },
        })
      : Promise.resolve([] as { package: { packageCourses: { courseId: string }[] } | null }[]),
  ]);

  const deniedSet = new Set(denials.map((d) => d.courseId));
  const directCourseSet = new Set(directCourses.map((d) => d.courseId));
  const directPackageCovers = new Set<string>();
  for (const r of directPackageRows) {
    for (const pc of r.package?.packageCourses ?? []) {
      if (courseSet.has(pc.courseId)) directPackageCovers.add(pc.courseId);
    }
  }
  const batchCourseSet = new Set(batchCourses.map((b) => b.courseId));
  const batchPackageCovers = new Set<string>();
  for (const r of batchPackageRows) {
    for (const pc of r.package?.packageCourses ?? []) {
      if (courseSet.has(pc.courseId)) batchPackageCovers.add(pc.courseId);
    }
  }

  for (const id of courseIds) {
    if (deniedSet.has(id)) {
      result.set(id, ["denied"]);
      continue;
    }
    const sources: AccessSource[] = [];
    if (directCourseSet.has(id)) sources.push("direct_course");
    if (directPackageCovers.has(id)) sources.push("direct_package");
    if (batchCourseSet.has(id)) sources.push("batch_course");
    if (batchPackageCovers.has(id)) sources.push("batch_package");
    result.set(id, sources);
  }
  return result;
}

/** Explains why a student has access to a course. Returns ["denied"] if denied. */
export async function getStudentAccessSources(
  studentId: string,
  courseId: string,
): Promise<AccessSource[]> {
  if (await isCourseDenied(studentId, courseId)) return ["denied"];

  const sources: AccessSource[] = [];
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { batchId: true },
  });
  if (!student) return sources;

  if (
    await prisma.studentCourse.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { id: true },
    })
  ) {
    sources.push("direct_course");
  }

  if (
    await prisma.studentPackage.findFirst({
      where: {
        studentId,
        package: { status: "active", packageCourses: { some: { courseId } } },
      },
      select: { id: true },
    })
  ) {
    sources.push("direct_package");
  }

  if (student.batchId) {
    if (
      await prisma.batchCourse.findUnique({
        where: { batchId_courseId: { batchId: student.batchId, courseId } },
        select: { id: true },
      })
    ) {
      sources.push("batch_course");
    }
    if (
      await prisma.batchPackage.findFirst({
        where: {
          batchId: student.batchId,
          package: { status: "active", packageCourses: { some: { courseId } } },
        },
        select: { id: true },
      })
    ) {
      sources.push("batch_package");
    }
  }

  return sources;
}
