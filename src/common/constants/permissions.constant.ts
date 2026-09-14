import { Role } from '../interfaces/auth.interface';

export const PERMISSIONS = {
  // Course Permissions
  COURSE_VIEW: 'view:course',
  COURSE_CREATE: 'create:course',
  COURSE_EDIT: 'edit:course',
  COURSE_DELETE: 'delete:course',
  COURSE_PUBLISH: 'publish:course',
  COURSE_APPROVE: 'approve:course',

  // Section Permissions
  SECTION_VIEW: 'view:section',
  SECTION_CREATE: 'create:section',
  SECTION_EDIT: 'edit:section',
  SECTION_DELETE: 'delete:section',
  SECTION_REORDER: 'reorder:section',

  // Lesson Permissions
  LESSON_VIEW: 'view:lesson',
  LESSON_CREATE: 'create:lesson',
  LESSON_EDIT: 'edit:lesson',
  LESSON_DELETE: 'delete:lesson',
  LESSON_REORDER: 'reorder:lesson',

  // User Management Permissions
  USER_VIEW: 'view:user',
  USER_CREATE: 'create:user',
  USER_EDIT: 'edit:user',
  USER_DELETE: 'delete:user',
  USER_INVITE: 'invite:user',
  USER_UPDATE: 'update:user',

  // Enrollment Permissions
  ENROLLMENT_VIEW: 'view:enrollment',
  ENROLLMENT_VIEW_ALL: 'view:all:enrollment',
  ENROLLMENT_CREATE: 'create:enrollment',
  ENROLLMENT_DELETE: 'delete:enrollment',
  ENROLLMENT_BULK_CREATE: 'bulk:create:enrollment',

  // Progress Permissions
  PROGRESS_VIEW: 'view:progress',
  PROGRESS_UPDATE: 'update:progress',

  // Analytics Permissions
  ANALYTICS_VIEW: 'view:analytics',
  ANALYTICS_EXPORT: 'export:analytics',

  // 🆕 AI Analytics Permissions
  AI_ANALYTICS_VIEW: 'view:ai:analytics',
  AI_ANALYTICS_REFRESH: 'refresh:ai:analytics',
  AI_RECOMMENDATION_FEEDBACK: 'submit:ai:recommendation:feedback',

  // Tenant Settings Permissions
  SETTINGS_VIEW: 'view:settings',
  SETTINGS_EDIT: 'edit:settings',

  // Tenant Management Permissions
  TENANT_MANAGE: 'manage:tenant',

  // Course purchase
  COURSE_PURCHASE: 'purchase:course',

  // Tenant-level announcements
  ANNOUNCEMENT_TENANT_CREATE: 'create:tenant:announcement',
  ANNOUNCEMENT_TENANT_EDIT: 'edit:tenant:announcement',
  ANNOUNCEMENT_TENANT_DELETE: 'delete:tenant:announcement',
  ANNOUNCEMENT_TENANT_VIEW: 'view:tenant:announcement',

  // Course-level announcements
  ANNOUNCEMENT_COURSE_CREATE: 'create:course:announcement',
  ANNOUNCEMENT_COURSE_EDIT: 'edit:course:announcement',
  ANNOUNCEMENT_COURSE_DELETE: 'delete:course:announcement',
  ANNOUNCEMENT_COURSE_VIEW: 'view:course:announcement',

  ANNOUNCEMENT_NOTIFICATION_READ: 'read:announcement:notification',

  // Test Management
  TEST_VIEW: 'view:test',
  TEST_CREATE: 'create:test',
  TEST_EDIT: 'edit:test',
  TEST_DELETE: 'delete:test',
  TEST_PUBLISH: 'publish:test',

  // Question Management
  QUESTION_CREATE: 'create:question',
  QUESTION_EDIT: 'edit:question',
  QUESTION_DELETE: 'delete:question',

  // Question Bank
  QUESTION_BANK_VIEW: 'view:questionbank',
  QUESTION_BANK_CREATE: 'create:questionbank',
  QUESTION_BANK_EDIT: 'edit:questionbank',
  QUESTION_BANK_DELETE: 'delete:questionbank',
  QUESTION_BANK_REVIEW: 'review:questionbank',
  QUESTION_BANK_CONFIGURE: 'configure:questionbank',

  // Test Taking (Students)
  TEST_ATTEMPT: 'attempt:test',
  TEST_SUBMIT: 'submit:test',

  // Grading
  TEST_GRADE: 'grade:test',
  TEST_VIEW_RESULTS: 'view:test:results',
  TEST_VIEW_ALL_ATTEMPTS: 'view:all:test:attempts',

  // Self-evaluation
  TEST_SELF_EVALUATE: 'self:evaluate:test',

  // Live Class Permissions
  LIVE_CLASS_CREATE: 'create:liveclass',
  LIVE_CLASS_EDIT: 'edit:liveclass',
  LIVE_CLASS_DELETE: 'delete:liveclass',
  LIVE_CLASS_VIEW: 'view:liveclass',
  LIVE_CLASS_JOIN: 'join:liveclass',
  LIVE_CLASS_VIEW_ATTENDANCE: 'view:liveclass:attendance',

  // Product permissions
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',
  PRODUCT_VIEW: 'product:view',

  // Service booking permissions (availability + bookings management)
  BOOKING_MANAGE: 'manage:booking',
  BOOKING_VIEW: 'view:booking',

  // Category permissions
  CATEGORY_CREATE: 'category:create',
  CATEGORY_UPDATE: 'category:update',
  CATEGORY_DELETE: 'category:delete',
  CATEGORY_VIEW: 'category:view',


  // Quiz Management Permissions
  QUIZ_VIEW: 'view:quiz',
  QUIZ_CREATE: 'create:quiz',
  QUIZ_EDIT: 'edit:quiz',
  QUIZ_DELETE: 'delete:quiz',
  QUIZ_PUBLISH: 'publish:quiz',
  QUIZ_ARCHIVE: 'archive:quiz',

  // Quiz Taking (Students)
  QUIZ_ATTEMPT: 'attempt:quiz',
  QUIZ_SUBMIT: 'submit:quiz',
  QUIZ_VIEW_RESULTS: 'view:quiz:results',

  LABS_VIEW: 'labs:view',
  LABS_CREATE: 'labs:create',
  LABS_EDIT: 'labs:edit',
  LABS_DELETE: 'labs:delete',
  LABS_PUBLISH: 'labs:publish',
  CONTESTS_VIEW: 'contests:view',
  CONTESTS_CREATE: 'contests:create',
  CONTESTS_EDIT: 'contests:edit',
  CONTESTS_DELETE: 'contests:delete',

  // Doubt Permissions
  DOUBT_VIEW: 'view:doubt',
  DOUBT_CREATE: 'create:doubt',
  DOUBT_REPLY: 'reply:doubt',
  DOUBT_RESOLVE: 'resolve:doubt',
  DOUBT_MANAGE: 'manage:doubt',
  DOUBT_VIEW_ALL: 'view:all:doubts',

} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.ADMIN]: [
    // All permissions (Admin ke paas sab kuch hai)

    PERMISSIONS.TEST_VIEW,
    PERMISSIONS.TEST_CREATE,
    PERMISSIONS.TEST_EDIT,
    PERMISSIONS.TEST_DELETE,
    PERMISSIONS.TEST_PUBLISH,

    PERMISSIONS.QUESTION_CREATE,
    PERMISSIONS.QUESTION_EDIT,
    PERMISSIONS.QUESTION_DELETE,

    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CREATE,
    PERMISSIONS.QUESTION_BANK_EDIT,
    PERMISSIONS.QUESTION_BANK_DELETE,
    PERMISSIONS.QUESTION_BANK_REVIEW,
    PERMISSIONS.QUESTION_BANK_CONFIGURE,

    PERMISSIONS.TEST_ATTEMPT,
    PERMISSIONS.TEST_SUBMIT,

    PERMISSIONS.TEST_GRADE,
    PERMISSIONS.TEST_VIEW_RESULTS,
    PERMISSIONS.TEST_VIEW_ALL_ATTEMPTS,

    PERMISSIONS.TEST_SELF_EVALUATE,

    PERMISSIONS.ANNOUNCEMENT_TENANT_CREATE,
    PERMISSIONS.ANNOUNCEMENT_TENANT_EDIT,
    PERMISSIONS.ANNOUNCEMENT_TENANT_DELETE,
    PERMISSIONS.ANNOUNCEMENT_TENANT_VIEW,

    PERMISSIONS.ANNOUNCEMENT_COURSE_CREATE,
    PERMISSIONS.ANNOUNCEMENT_COURSE_EDIT,
    PERMISSIONS.ANNOUNCEMENT_COURSE_DELETE,
    PERMISSIONS.ANNOUNCEMENT_COURSE_VIEW,

    PERMISSIONS.ANNOUNCEMENT_NOTIFICATION_READ,

    PERMISSIONS.COURSE_VIEW,
    PERMISSIONS.COURSE_CREATE,
    PERMISSIONS.COURSE_EDIT,
    PERMISSIONS.COURSE_DELETE,
    PERMISSIONS.COURSE_PUBLISH,
    PERMISSIONS.COURSE_APPROVE,

    PERMISSIONS.SECTION_VIEW,
    PERMISSIONS.SECTION_CREATE,
    PERMISSIONS.SECTION_EDIT,
    PERMISSIONS.SECTION_DELETE,
    PERMISSIONS.SECTION_REORDER,

    PERMISSIONS.LESSON_VIEW,
    PERMISSIONS.LESSON_CREATE,
    PERMISSIONS.LESSON_EDIT,
    PERMISSIONS.LESSON_DELETE,
    PERMISSIONS.LESSON_REORDER,

    PERMISSIONS.USER_VIEW,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_EDIT,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.USER_INVITE,

    PERMISSIONS.ENROLLMENT_VIEW,
    PERMISSIONS.ENROLLMENT_VIEW_ALL,
    PERMISSIONS.ENROLLMENT_CREATE,
    PERMISSIONS.ENROLLMENT_DELETE,
    PERMISSIONS.ENROLLMENT_BULK_CREATE,

    PERMISSIONS.PROGRESS_VIEW,
    PERMISSIONS.PROGRESS_UPDATE,

    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,

    // 🆕 AI Analytics Permissions for Admin
    PERMISSIONS.AI_ANALYTICS_VIEW,
    PERMISSIONS.AI_ANALYTICS_REFRESH,
    PERMISSIONS.AI_RECOMMENDATION_FEEDBACK,

    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,

    PERMISSIONS.TENANT_MANAGE,

    PERMISSIONS.COURSE_PURCHASE,

    PERMISSIONS.LIVE_CLASS_CREATE,
    PERMISSIONS.LIVE_CLASS_EDIT,
    PERMISSIONS.LIVE_CLASS_DELETE,
    PERMISSIONS.LIVE_CLASS_VIEW,
    PERMISSIONS.LIVE_CLASS_JOIN,
    PERMISSIONS.LIVE_CLASS_VIEW_ATTENDANCE,

    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.BOOKING_VIEW,

    PERMISSIONS.QUIZ_VIEW,
    PERMISSIONS.QUIZ_CREATE,
    PERMISSIONS.QUIZ_EDIT,
    PERMISSIONS.QUIZ_DELETE,
    PERMISSIONS.QUIZ_PUBLISH,
    PERMISSIONS.QUIZ_ARCHIVE,
    PERMISSIONS.QUIZ_ATTEMPT,
    PERMISSIONS.QUIZ_SUBMIT,
    PERMISSIONS.QUIZ_VIEW_RESULTS,
    // Doubt permissions for Admin
    PERMISSIONS.DOUBT_VIEW,
    PERMISSIONS.DOUBT_VIEW_ALL,
    PERMISSIONS.DOUBT_CREATE,
    PERMISSIONS.DOUBT_REPLY,
    PERMISSIONS.DOUBT_RESOLVE,
    PERMISSIONS.DOUBT_MANAGE,
  ],

  [Role.TEACHER]: [
    PERMISSIONS.TEST_VIEW,
    PERMISSIONS.TEST_CREATE,
    PERMISSIONS.TEST_EDIT,
    PERMISSIONS.TEST_DELETE,
    PERMISSIONS.TEST_PUBLISH,

    PERMISSIONS.QUESTION_CREATE,
    PERMISSIONS.QUESTION_EDIT,
    PERMISSIONS.QUESTION_DELETE,

    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CREATE,
    PERMISSIONS.QUESTION_BANK_EDIT,

    PERMISSIONS.TEST_GRADE,
    PERMISSIONS.TEST_VIEW_RESULTS,
    PERMISSIONS.TEST_VIEW_ALL_ATTEMPTS,

    PERMISSIONS.TEST_SELF_EVALUATE,

    PERMISSIONS.COURSE_VIEW,
    PERMISSIONS.COURSE_CREATE,
    PERMISSIONS.COURSE_EDIT,
    PERMISSIONS.COURSE_PUBLISH,

    PERMISSIONS.ANNOUNCEMENT_COURSE_CREATE,
    PERMISSIONS.ANNOUNCEMENT_COURSE_EDIT,
    PERMISSIONS.ANNOUNCEMENT_COURSE_DELETE,
    PERMISSIONS.ANNOUNCEMENT_COURSE_VIEW,

    PERMISSIONS.ANNOUNCEMENT_NOTIFICATION_READ,

    PERMISSIONS.SECTION_VIEW,
    PERMISSIONS.SECTION_CREATE,
    PERMISSIONS.SECTION_EDIT,
    PERMISSIONS.SECTION_DELETE,
    PERMISSIONS.SECTION_REORDER,

    PERMISSIONS.LESSON_VIEW,
    PERMISSIONS.LESSON_CREATE,
    PERMISSIONS.LESSON_EDIT,
    PERMISSIONS.LESSON_DELETE,
    PERMISSIONS.LESSON_REORDER,

    PERMISSIONS.USER_VIEW,
    PERMISSIONS.USER_INVITE,

    PERMISSIONS.ENROLLMENT_VIEW,
    PERMISSIONS.ENROLLMENT_VIEW_ALL,
    PERMISSIONS.ENROLLMENT_CREATE,
    PERMISSIONS.ENROLLMENT_BULK_CREATE,

    PERMISSIONS.PROGRESS_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,

    // 🆕 AI Analytics Permissions for Teacher
    PERMISSIONS.AI_ANALYTICS_VIEW, // Teachers can view AI insights
    PERMISSIONS.AI_RECOMMENDATION_FEEDBACK, // Can submit feedback

    PERMISSIONS.COURSE_PURCHASE,

    PERMISSIONS.LIVE_CLASS_CREATE,
    PERMISSIONS.LIVE_CLASS_EDIT,
    PERMISSIONS.LIVE_CLASS_DELETE,
    PERMISSIONS.LIVE_CLASS_VIEW,
    PERMISSIONS.LIVE_CLASS_VIEW_ATTENDANCE,
    // A teacher could create, edit and delete a live class but not join one:
    // every LIVE_CLASS_JOIN query -- liveQuizBatch among them -- was refused
    // for the exact role that runs the lesson. Admin has had it all along.
    PERMISSIONS.LIVE_CLASS_JOIN,

    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.BOOKING_VIEW,

    PERMISSIONS.QUIZ_VIEW,
    PERMISSIONS.QUIZ_CREATE,
    PERMISSIONS.QUIZ_EDIT,
    PERMISSIONS.QUIZ_DELETE,
    PERMISSIONS.QUIZ_PUBLISH,
    PERMISSIONS.QUIZ_ARCHIVE,


    PERMISSIONS.DOUBT_VIEW,
    PERMISSIONS.DOUBT_VIEW_ALL,
    PERMISSIONS.DOUBT_CREATE,
    PERMISSIONS.DOUBT_REPLY,
    PERMISSIONS.DOUBT_RESOLVE,
    PERMISSIONS.DOUBT_MANAGE,

  ],

  [Role.STUDENT]: [
    PERMISSIONS.TEST_VIEW,
    PERMISSIONS.TEST_ATTEMPT,
    PERMISSIONS.TEST_SUBMIT,
    PERMISSIONS.TEST_SELF_EVALUATE,
    PERMISSIONS.TEST_VIEW_RESULTS,

    PERMISSIONS.COURSE_VIEW,
    PERMISSIONS.SECTION_VIEW,
    PERMISSIONS.LESSON_VIEW,

    PERMISSIONS.ENROLLMENT_VIEW,

    PERMISSIONS.PROGRESS_VIEW,
    PERMISSIONS.PROGRESS_UPDATE,

    PERMISSIONS.COURSE_PURCHASE,

    PERMISSIONS.ANNOUNCEMENT_TENANT_VIEW,
    PERMISSIONS.ANNOUNCEMENT_COURSE_VIEW,

    PERMISSIONS.ANNOUNCEMENT_NOTIFICATION_READ,

    PERMISSIONS.LIVE_CLASS_VIEW,
    PERMISSIONS.LIVE_CLASS_JOIN,

    PERMISSIONS.QUIZ_VIEW,
    PERMISSIONS.QUIZ_ATTEMPT,
    PERMISSIONS.QUIZ_SUBMIT,
    PERMISSIONS.QUIZ_VIEW_RESULTS,

    // Doubt permissions for Student
    PERMISSIONS.DOUBT_VIEW,    // Can view their own doubts
    PERMISSIONS.DOUBT_CREATE,  // Can create doubts
    PERMISSIONS.DOUBT_REPLY,   // Can reply to their own doubts
    PERMISSIONS.DOUBT_RESOLVE, // Can mark their own doubts as solved
    // ❌ Students ko AI Analytics nahi milega - intentionally not added
  ],
} as const;

export function hasPermission(role: Role, permission: Permission): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role];
  if (!rolePermissions) return false;
  return rolePermissions.includes(permission);
}

export function hasAnyPermission(
  role: Role,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function hasAllPermissions(
  role: Role,
  permissions: Permission[],
): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
