import 'dotenv/config'
import crypto from 'node:crypto'
import { scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import express from 'express'
import helmet from 'helmet'
import multer from 'multer'
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(process.env.API_DATA_DIR || path.join(projectRoot, 'server', 'data'))
const mediaDir = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(projectRoot, 'server', 'storage'))
const receiptDir = path.join(mediaDir, 'receipts')
const tempDir = path.join(dataDir, 'tmp')
const port = Number(process.env.API_PORT || 3001)
const maxVideoBytes = Number(process.env.MAX_VIDEO_BYTES || 5 * 1024 ** 3)
const maxDocumentBytes = Number(process.env.MAX_DOCUMENT_BYTES || 100 * 1024 ** 2)
const maxStorageBytes = Number(process.env.MAX_STORAGE_BYTES || 500 * 1024 ** 3)
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000
const sessionCookie = 'lessonwell_session'

await fs.mkdir(tempDir, { recursive: true })
await fs.mkdir(mediaDir, { recursive: true })
await fs.mkdir(receiptDir, { recursive: true })

const db = new Database(path.join(dataDir, 'lessonwell.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    subject TEXT NOT NULL DEFAULT '',
    class_level TEXT NOT NULL DEFAULT '',
    instructor TEXT NOT NULL DEFAULT '',
    price_pkr INTEGER NOT NULL DEFAULT 0,
    subscription_days INTEGER NOT NULL DEFAULT 365,
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('lecture', 'material')),
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    price_pkr INTEGER NOT NULL DEFAULT 1000,
    created_by TEXT NOT NULL DEFAULT '',
    quality TEXT,
    duration TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS content_course_chapter ON content(course_id, chapter_id);
  CREATE TABLE IF NOT EXISTS enrollments (
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (student_email, course_id)
  );
  CREATE TABLE IF NOT EXISTS purchases (
    student_email TEXT NOT NULL,
    course_id TEXT,
    content_id TEXT,
    amount_pkr INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    student_email TEXT NOT NULL,
    course_id TEXT,
    content_id TEXT,
    amount_pkr INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    bank_name TEXT NOT NULL,
    account_title TEXT NOT NULL,
    account_number TEXT NOT NULL,
    transfer_reference TEXT NOT NULL DEFAULT '',
    receipt_file TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by TEXT,
    review_note TEXT
    ,coupon_code TEXT
    ,discount_pkr INTEGER NOT NULL DEFAULT 0
    ,base_amount_pkr INTEGER NOT NULL DEFAULT 0
    ,method_name TEXT NOT NULL DEFAULT ''
    ,payment_details TEXT NOT NULL DEFAULT ''
    ,receipt_mime_type TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS auth_challenges (
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'reset')),
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    name TEXT,
    phone TEXT,
    password_salt TEXT,
    password_hash TEXT,
    PRIMARY KEY (email, purpose)
  );
`)

for (const table of ['users', 'sessions']) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql || ''
  if (!definition.includes("'teacher'")) {
    const legacy = `${table}_legacy`
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE ${table} RENAME TO ${legacy};
      ${table === 'users'
        ? `CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')), password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);`
        : `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')), expires_at INTEGER NOT NULL);`}
      INSERT INTO ${table} SELECT * FROM ${legacy};
      DROP TABLE ${legacy};
      COMMIT;`)
  }
}

if (!db.pragma('table_info(users)').some((column) => column.name === 'active')) {
  db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
}
if (!db.pragma('table_info(courses)').some((column) => column.name === 'subscription_days')) {
  db.exec('ALTER TABLE courses ADD COLUMN subscription_days INTEGER NOT NULL DEFAULT 365')
}
if (!db.pragma('table_info(content)').some((column) => column.name === 'created_by')) {
  db.exec("ALTER TABLE content ADD COLUMN created_by TEXT NOT NULL DEFAULT ''")
}

if (!db.pragma('table_info(content)').some((column) => column.name === 'price_pkr')) {
  db.exec('ALTER TABLE content ADD COLUMN price_pkr INTEGER NOT NULL DEFAULT 1000')
}
if (!db.pragma('table_info(purchases)').some((column) => column.name === 'course_id')) {
  const oldPurchases = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'purchases'").get()
  if (oldPurchases) {
    db.exec('ALTER TABLE purchases RENAME TO purchases_legacy')
    db.exec(`CREATE TABLE purchases (
      student_email TEXT NOT NULL,
      course_id TEXT,
      content_id TEXT,
      amount_pkr INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
    db.exec(`INSERT INTO purchases (student_email, course_id, content_id, amount_pkr, status, provider, created_at)
      SELECT student_email, NULL, content_id, amount_pkr, status, provider, created_at FROM purchases_legacy`)
    db.exec('DROP TABLE purchases_legacy')
  }
}

if (!db.pragma('table_info(payment_orders)').some((column) => column.name === 'course_id')) {
  const oldOrders = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_orders'").get()
  if (oldOrders) {
    db.exec('ALTER TABLE payment_orders RENAME TO payment_orders_legacy')
    db.exec(`CREATE TABLE payment_orders (
      id TEXT PRIMARY KEY,
      student_email TEXT NOT NULL,
      course_id TEXT,
      content_id TEXT,
      amount_pkr INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      bank_name TEXT NOT NULL,
      account_title TEXT NOT NULL,
      account_number TEXT NOT NULL,
      transfer_reference TEXT NOT NULL DEFAULT '',
      receipt_file TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      review_note TEXT
    )`)
    db.exec(`INSERT INTO payment_orders (id, student_email, course_id, content_id, amount_pkr, status, bank_name, account_title, account_number, transfer_reference, receipt_file, notes, created_at, reviewed_at, reviewed_by, review_note)
      SELECT id, student_email, NULL, content_id, amount_pkr, status, bank_name, account_title, account_number, transfer_reference, receipt_file, notes, created_at, reviewed_at, reviewed_by, review_note FROM payment_orders_legacy`)
    db.exec('DROP TABLE payment_orders_legacy')
  }
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS purchases_student_course_unique ON purchases (student_email, course_id) WHERE course_id IS NOT NULL`)
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS purchases_student_content_unique ON purchases (student_email, content_id) WHERE content_id IS NOT NULL`)
db.exec(`
  CREATE TABLE IF NOT EXISTS teacher_permissions (
    teacher_email TEXT PRIMARY KEY,
    upload_videos INTEGER NOT NULL DEFAULT 0,
    upload_pdfs INTEGER NOT NULL DEFAULT 0,
    create_quizzes INTEGER NOT NULL DEFAULT 0,
    create_tests INTEGER NOT NULL DEFAULT 0,
    schedule_live_classes INTEGER NOT NULL DEFAULT 0,
    view_student_progress INTEGER NOT NULL DEFAULT 0,
    view_attendance INTEGER NOT NULL DEFAULT 0,
    edit_courses INTEGER NOT NULL DEFAULT 0,
    delete_content INTEGER NOT NULL DEFAULT 0,
    manage_assignments INTEGER NOT NULL DEFAULT 0,
    manage_students INTEGER NOT NULL DEFAULT 0,
    manage_payments INTEGER NOT NULL DEFAULT 0,
    manage_feedback INTEGER NOT NULL DEFAULT 0,
    send_announcements INTEGER NOT NULL DEFAULT 0
    ,manage_discussions INTEGER NOT NULL DEFAULT 0
    ,manage_messages INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS teacher_course_assignments (
    id TEXT PRIMARY KEY,
    teacher_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    chapter_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS teacher_course_assignment_unique
    ON teacher_course_assignments (teacher_email, course_id, COALESCE(chapter_id, ''));
  CREATE TABLE IF NOT EXISTS course_assignments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT,
    title TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    points INTEGER NOT NULL DEFAULT 100,
    published INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignment_submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_email TEXT NOT NULL,
    answer TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    grade REAL,
    feedback TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT,
    reviewed_at TEXT,
    UNIQUE (assignment_id, student_email)
  );
  CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('quiz', 'test')),
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0,
    randomize INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assessment_questions (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS assessment_attempts (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL,
    student_email TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percentage INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    submitted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assessment_attempt_questions (
    attempt_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    displayed_options_json TEXT NOT NULL,
    displayed_correct_index INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (attempt_id, question_id)
  );
  CREATE TABLE IF NOT EXISTS lesson_progress (
    student_email TEXT NOT NULL,
    content_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (student_email, content_id)
  );
  CREATE TABLE IF NOT EXISTS live_classes (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    meeting_url TEXT NOT NULL,
    recording_content_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_class_attendance (
    live_class_id TEXT NOT NULL,
    student_email TEXT NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0,
    marked_by TEXT NOT NULL,
    marked_at TEXT NOT NULL,
    PRIMARY KEY (live_class_id, student_email)
  );
  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    course_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    announcement_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    content_id TEXT,
    teacher_email TEXT,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback_responses (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL,
    teacher_email TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discussion_posts (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    parent_id TEXT,
    author_email TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS discussion_posts_course ON discussion_posts (course_id, created_at);
  CREATE TABLE IF NOT EXISTS student_questions (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    student_email TEXT NOT NULL,
    teacher_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS question_messages (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    verification_code TEXT NOT NULL UNIQUE,
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    UNIQUE (student_email, course_id)
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value INTEGER NOT NULL,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    course_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL,
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    order_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE (coupon_id, student_email, course_id)
  );
  CREATE TABLE IF NOT EXISTS teacher_course_messages (
    teacher_email TEXT NOT NULL,
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    opted_in INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (teacher_email, student_email, course_id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    student_email TEXT NOT NULL,
    course_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled')),
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    amount_pkr INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (student_email, course_id)
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

if (!db.pragma('table_info(teacher_permissions)').some((column) => column.name === 'manage_assignments')) {
  db.exec('ALTER TABLE teacher_permissions ADD COLUMN manage_assignments INTEGER NOT NULL DEFAULT 0')
}
for (const [table, column, definition] of [
  ['courses', 'subject', "TEXT NOT NULL DEFAULT ''"],
  ['courses', 'class_level', "TEXT NOT NULL DEFAULT ''"],
  ['chapters', 'topic', "TEXT NOT NULL DEFAULT ''"],
  ['assessments', 'is_free', 'INTEGER NOT NULL DEFAULT 0'],
  ['course_assignments', 'is_free', 'INTEGER NOT NULL DEFAULT 0'],
  ['payment_orders', 'coupon_code', 'TEXT'],
  ['payment_orders', 'discount_pkr', 'INTEGER NOT NULL DEFAULT 0'],
  ['payment_orders', 'base_amount_pkr', 'INTEGER NOT NULL DEFAULT 0'],
  ['payment_orders', 'method_name', "TEXT NOT NULL DEFAULT ''"],
  ['payment_orders', 'payment_details', "TEXT NOT NULL DEFAULT ''"],
  ['payment_orders', 'receipt_mime_type', "TEXT NOT NULL DEFAULT ''"],
  ['teacher_permissions', 'manage_discussions', 'INTEGER NOT NULL DEFAULT 0'],
  ['teacher_permissions', 'manage_messages', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'leaderboard_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!db.pragma(`table_info(${table})`).some((columnInfo) => columnInfo.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

const saveDefaultSetting = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)')
saveDefaultSetting.run('platformName', 'Paragon Academy')
db.prepare("UPDATE site_settings SET value = 'Paragon Academy' WHERE key = 'platformName' AND value = 'Lessonwell'").run()
saveDefaultSetting.run('supportEmail', '')
saveDefaultSetting.run('defaultSubscriptionDays', '365')
saveDefaultSetting.run('paymentMethods', JSON.stringify([
  { id: 'bank-transfer', name: 'Bank transfer', instructions: 'Transfer the course fee to the account details provided by the Owner, then submit the transaction reference and payment screenshot.', enabled: true },
]))

const app = express()
app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(express.json({ limit: '1mb' }))
const paymentReceiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 4 * 1024 ** 2 },
}).single('receipt')

function HttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function sendVerificationEmail(email, otp) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    throw HttpError(503, 'Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the API server.')
  }

  const action = 'reset your password'
  const subject = 'Reset your Paragon Academy password'
  const text = `Your Paragon Academy code to ${action} is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
  const html = `<p>Your Paragon Academy code to ${action} is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`

  let providerResponse
  try {
    providerResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    console.error('Resend verification email request failed.', error.message)
    throw HttpError(502, 'Could not send the verification email. Please try again.')
  }

  if (!providerResponse.ok) {
    console.error(`Resend rejected verification email delivery (HTTP ${providerResponse.status}).`)
    throw HttpError(502, 'Email delivery failed. Check the Resend API key and verified sender address.')
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
  }))
}

function createSession(email, role, response) {
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, email, role, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), email, role, Date.now() + sessionTtlMs)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${sessionTtlMs / 1000}${secure}`)
}

function requireSession(request, response, next) {
  const token = parseCookies(request.headers.cookie)[sessionCookie]
  if (!token) return next(HttpError(401, 'Sign in is required.'))
  const session = db.prepare('SELECT email, role, expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token))
  if (!session || session.expires_at <= Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return next(HttpError(401, 'Your session has expired.'))
  }
  request.user = { email: session.email, role: session.role }
  next()
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return next(HttpError(403, 'Admin access is required.'))
  next()
}

const teacherPermissionColumns = {
  uploadVideos: 'upload_videos',
  uploadPdfs: 'upload_pdfs',
  createQuizzes: 'create_quizzes',
  createTests: 'create_tests',
  scheduleLiveClasses: 'schedule_live_classes',
  viewStudentProgress: 'view_student_progress',
  viewAttendance: 'view_attendance',
  editCourses: 'edit_courses',
  deleteContent: 'delete_content',
  manageAssignments: 'manage_assignments',
  manageStudents: 'manage_students',
  managePayments: 'manage_payments',
  manageFeedback: 'manage_feedback',
  sendAnnouncements: 'send_announcements',
  manageDiscussions: 'manage_discussions',
  manageMessages: 'manage_messages',
}

function getTeacherPermissions(email) {
  const row = db.prepare('SELECT * FROM teacher_permissions WHERE teacher_email = ?').get(email)
  return Object.fromEntries(Object.entries(teacherPermissionColumns).map(([permission, column]) => [permission, Boolean(row?.[column])]))
}

function hasTeacherCourseAssignment(email, courseId, chapterId) {
  if (!courseId) return false
  if (!chapterId) return Boolean(db.prepare('SELECT 1 FROM teacher_course_assignments WHERE teacher_email = ? AND course_id = ? LIMIT 1').get(email, courseId))
  return Boolean(db.prepare(`SELECT 1 FROM teacher_course_assignments
    WHERE teacher_email = ? AND course_id = ? AND (chapter_id IS NULL OR chapter_id = ?) LIMIT 1`).get(email, courseId, chapterId))
}

function requireTeacherPermission(permission, { courseParam = 'courseId', chapterParam = 'chapterId' } = {}) {
  return (request, response, next) => {
    if (request.user?.role === 'admin') return next()
    if (request.user?.role !== 'teacher') return next(HttpError(403, 'Teacher access is required.'))
    const column = teacherPermissionColumns[permission]
    const granted = column && db.prepare(`SELECT ${column} AS granted FROM teacher_permissions WHERE teacher_email = ?`).get(request.user.email)?.granted
    if (!granted) return next(HttpError(403, `The owner has not granted the ${permission} permission.`))
    const courseId = request.params[courseParam]
    const chapterId = request.params[chapterParam]
    if (!hasTeacherCourseAssignment(request.user.email, courseId, chapterId)) {
      return next(HttpError(403, 'This course or chapter is not assigned to your account.'))
    }
    next()
  }
}

function canManageAssignedCourse(request, courseId, chapterId, permission) {
  return request.user.role === 'admin' || (
    request.user.role === 'teacher'
    && Boolean(db.prepare(`SELECT ${teacherPermissionColumns[permission]} AS granted FROM teacher_permissions WHERE teacher_email = ?`).get(request.user.email)?.granted)
    && hasTeacherCourseAssignment(request.user.email, courseId, chapterId)
  )
}

function requireContentPermission(permission) {
  return (request, response, next) => {
    if (request.user?.role === 'admin') return next()
    if (request.user?.role !== 'teacher') return next(HttpError(403, 'Teacher access is required.'))
    const item = db.prepare('SELECT course_id, chapter_id, created_by FROM content WHERE id = ?').get(request.params.id)
    if (!item) return next(HttpError(404, 'Content was not found.'))
    if (!canManageAssignedCourse(request, item.course_id, item.chapter_id, permission)) {
      return next(HttpError(403, `The owner has not granted the ${permission} permission for this course or chapter.`))
    }
    if (permission === 'deleteContent' && item.created_by !== request.user.email) {
      return next(HttpError(403, 'Teachers can only remove content they uploaded.'))
    }
    next()
  }
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}

function cleanFileName(value) {
  return path.basename(value).replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'content'
}

function shuffle(values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1)
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function storageUsage() {
  return db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS used FROM content').get().used
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = scryptSync(password, salt, 64).toString('hex')
  return { salt, passwordHash }
}

function verifyPassword(password, salt, expectedHash) {
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function seedAdminFromEnvironment() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  if (!email || !password) return
  const existing = db.prepare('SELECT role FROM users WHERE email = ?').get(email)
  if (existing) {
    if (existing.role !== 'admin') throw new Error('ADMIN_EMAIL is already registered as a non-admin user.')
    return
  }
  const { salt, passwordHash } = makePasswordRecord(password)
  db.prepare(`INSERT INTO users (email, name, role, password_salt, password_hash, created_at)
    VALUES (?, ?, 'admin', ?, ?, ?)`).run(email, process.env.ADMIN_NAME || 'Administrator', salt, passwordHash, new Date().toISOString())
}

seedAdminFromEnvironment()

function listCourses(role, email) {
  const courses = role === 'admin' || role === 'teacher'
    ? db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM courses WHERE published = 1 ORDER BY created_at DESC').all()
  return courses.map((course) => {
    const purchased = role === 'admin' || (role === 'student' && hasApprovedCoursePurchase(email, course.id))
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      subject: course.subject,
      classLevel: course.class_level,
      instructor: course.instructor,
      price: course.price_pkr,
      subscriptionDays: course.subscription_days,
      published: Boolean(course.published),
      purchased,
      subscription: role === 'student'
        ? db.prepare(`SELECT status, starts_at AS startsAt, expires_at AS expiresAt
          FROM subscriptions WHERE student_email = ? AND course_id = ?`).get(email, course.id) || null
        : null,
      createdAt: course.created_at,
      chapters: db.prepare('SELECT * FROM chapters WHERE course_id = ? ORDER BY position, created_at').all(course.id).map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        description: chapter.description,
        topic: chapter.topic,
        lectures: db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, kind, title,
          original_name AS fileName, mime_type AS mimeType, byte_size AS size, price_pkr AS pricePkr, created_by AS createdBy, quality, duration, created_at AS createdAt
          FROM content WHERE chapter_id = ? AND kind = 'lecture' ORDER BY created_at`).all(chapter.id).map((item) => ({
            ...item,
            purchased,
          })),
        materials: db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, kind, title,
          original_name AS fileName, mime_type AS mimeType, byte_size AS size, price_pkr AS pricePkr, created_by AS createdBy, created_at AS createdAt
          FROM content WHERE chapter_id = ? AND kind = 'material' ORDER BY created_at`).all(chapter.id).map((item) => ({
            ...item,
            format: 'PDF',
            purchased,
          })),
      })),
    }
  })
}

function hasApprovedCoursePurchase(studentEmail, courseId) {
  if (db.prepare('SELECT 1 FROM courses WHERE id = ? AND price_pkr = 0 AND published = 1').get(courseId)) return true
  return Boolean(db.prepare("SELECT 1 FROM purchases WHERE student_email = ? AND course_id = ? AND status = 'paid'").get(studentEmail, courseId))
    || Boolean(db.prepare("SELECT 1 FROM payment_orders WHERE student_email = ? AND course_id = ? AND status = 'approved'").get(studentEmail, courseId))
    || Boolean(db.prepare(`SELECT 1 FROM subscriptions
      WHERE student_email = ? AND course_id = ? AND status = 'active' AND expires_at > ?`)
      .get(studentEmail, courseId, new Date().toISOString()))
}

function studentCanAccessCoursework(studentEmail, courseId, isFree) {
  return Boolean(isFree) || hasApprovedCoursePurchase(studentEmail, courseId)
}

function notifyAdmins(title, body) {
  const admins = db.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all()
  const createdAt = new Date().toISOString()
  const add = db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`)
  for (const admin of admins) {
    add.run(crypto.randomUUID(), admin.email, title, body, createdAt)
  }
}

function activateCourseSubscription(studentEmail, courseId, amountPkr) {
  const now = new Date()
  const nowIso = now.toISOString()
  const current = db.prepare(`SELECT expires_at FROM subscriptions
    WHERE student_email = ? AND course_id = ? AND status = 'active' AND expires_at > ?`).get(studentEmail, courseId, nowIso)
  const startsAt = current?.expires_at || nowIso
  const days = db.prepare('SELECT subscription_days FROM courses WHERE id = ?').get(courseId)?.subscription_days || 365
  const expiresAt = new Date(new Date(startsAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(`INSERT INTO subscriptions (student_email, course_id, status, starts_at, expires_at, amount_pkr, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?)
    ON CONFLICT(student_email, course_id) DO UPDATE SET status = 'active', expires_at = excluded.expires_at,
      amount_pkr = excluded.amount_pkr, updated_at = excluded.updated_at`)
    .run(studentEmail, courseId, startsAt, expiresAt, amountPkr, nowIso)
  return { startsAt, expiresAt }
}

function notifyCourseStudents(courseId, title, body) {
  const recipients = db.prepare("SELECT email FROM users WHERE role = 'student' AND active = 1").all()
  const createdAt = new Date().toISOString()
  const add = db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`)
  for (const recipient of recipients) {
    if (courseId && !hasApprovedCoursePurchase(recipient.email, courseId)) continue
    add.run(crypto.randomUUID(), recipient.email, title, body, createdAt)
  }
}

function buildPaymentOrderReference() {
  const prefix = 'LW'
  const stamp = Date.now().toString(36).toUpperCase()
  const random = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `${prefix}${stamp}${random}`
}

function evaluateCoupon(codeValue, courseId, studentEmail) {
  const code = String(codeValue || '').trim().toUpperCase()
  if (!code) return { code: null, discountPkr: 0 }
  const coupon = db.prepare(`SELECT * FROM coupons WHERE code = ? COLLATE NOCASE AND active = 1`).get(code)
  if (!coupon) throw HttpError(400, 'This coupon code is invalid or inactive.')
  if (coupon.expires_at && coupon.expires_at <= new Date().toISOString()) throw HttpError(400, 'This coupon has expired.')
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) throw HttpError(409, 'This coupon has reached its redemption limit.')
  if (coupon.course_id && coupon.course_id !== courseId) throw HttpError(400, 'This coupon does not apply to the selected course.')
  if (db.prepare('SELECT 1 FROM coupon_redemptions WHERE coupon_id = ? AND student_email = ? AND course_id = ?').get(coupon.id, studentEmail, courseId)) {
    throw HttpError(409, 'This coupon has already been used for this course.')
  }
  const price = db.prepare('SELECT price_pkr FROM courses WHERE id = ?').get(courseId)?.price_pkr
  if (!Number.isSafeInteger(price)) throw HttpError(404, 'Course was not found.')
  const discountPkr = Math.min(price, coupon.discount_type === 'percent'
    ? Math.floor(price * coupon.discount_value / 100)
    : coupon.discount_value)
  return { code: coupon.code, couponId: coupon.id, discountPkr }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, tempDir),
    filename: (_request, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { files: 1, fileSize: maxVideoBytes },
})

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'lessonwell-api', storage: { usedBytes: storageUsage(), limitBytes: maxStorageBytes } })
})

app.post('/api/auth/login', (request, response, next) => {
  const email = String(request.body?.email || '').trim().toLowerCase()
  const password = String(request.body?.password || '')
  const role = request.body?.role
  if (!email || !password || !['admin', 'student', 'teacher'].includes(role)) return next(HttpError(400, 'Email, password, and account type are required.'))
  const user = db.prepare('SELECT email, name, role, password_salt, password_hash, active FROM users WHERE email = ?').get(email)
  if (!user || !user.active || user.role !== role || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return next(HttpError(401, 'Email or password is incorrect.'))
  }
  createSession(user.email, user.role, response)
  response.json({ user: {
    email: user.email,
    name: user.name,
    role: user.role,
    ...(user.role === 'teacher' ? { permissions: getTeacherPermissions(user.email) } : {}),
  } })
})

app.post('/api/auth/signup', (request, response, next) => {
  const name = String(request.body?.name || '').trim().slice(0, 100)
  const phone = String(request.body?.phone || '').trim().slice(0, 30)
  const email = String(request.body?.email || '').trim().toLowerCase()
  const password = String(request.body?.password || '')
  if (!name || !email.includes('@') || password.length < 8) return next(HttpError(400, 'Provide a name, valid email, and password with at least 8 characters.'))
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return next(HttpError(409, 'An account with this email already exists.'))
  const { salt, passwordHash } = makePasswordRecord(password)
  const createdAt = new Date().toISOString()
  const createStudent = db.transaction(() => {
    db.prepare(`INSERT INTO users (email, name, phone, role, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, 'student', ?, ?, ?)`)
      .run(email, name, phone, salt, passwordHash, createdAt)
    db.prepare("DELETE FROM auth_challenges WHERE email = ? AND purpose = 'signup'").run(email)
  })
  createStudent()
  createSession(email, 'student', response)
  response.status(201).json({
    user: { email, name, role: 'student' },
    message: 'Student account created successfully.',
  })
})

app.post('/api/auth/reset/request', async (request, response, next) => {
  const email = String(request.body?.email || '').trim().toLowerCase()
  const role = request.body?.role
  const user = db.prepare('SELECT 1 FROM users WHERE email = ? AND role = ?').get(email, role)
  if (!user) return next(HttpError(404, 'No account was found for that email and account type.'))
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  try {
    await sendVerificationEmail(email, otp)
  } catch (error) {
    return next(error)
  }
  db.prepare(`INSERT INTO auth_challenges (email, purpose, otp_hash, expires_at)
    VALUES (?, 'reset', ?, ?)
    ON CONFLICT(email, purpose) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at`)
    .run(email, hashToken(otp), Date.now() + 10 * 60 * 1000)
  response.json({ email, message: 'Password reset code sent to your email address.', expiresInSeconds: 600 })
})

app.post('/api/auth/reset/confirm', (request, response, next) => {
  const email = String(request.body?.email || '').trim().toLowerCase()
  const otp = String(request.body?.otp || '')
  const password = String(request.body?.password || '')
  const challenge = db.prepare("SELECT * FROM auth_challenges WHERE email = ? AND purpose = 'reset'").get(email)
  if (!challenge || challenge.expires_at < Date.now() || hashToken(otp) !== challenge.otp_hash) {
    return next(HttpError(400, 'Verification code is invalid or expired.'))
  }
  if (password.length < 8) return next(HttpError(400, 'Password must contain at least 8 characters.'))
  const { salt, passwordHash } = makePasswordRecord(password)
  db.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE email = ?').run(salt, passwordHash, email)
  db.prepare("DELETE FROM auth_challenges WHERE email = ? AND purpose = 'reset'").run(email)
  const user = db.prepare('SELECT name, role FROM users WHERE email = ?').get(email)
  createSession(email, user.role, response)
  response.json({ user: {
    email,
    name: user.name,
    role: user.role,
    ...(user.role === 'teacher' ? { permissions: getTeacherPermissions(email) } : {}),
  } })
})

app.post('/api/auth/logout', (request, response) => {
  const token = parseCookies(request.headers.cookie)[sessionCookie]
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  response.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0`)
  response.status(204).end()
})

app.get('/api/auth/me', requireSession, (request, response) => {
  response.json({ user: { ...request.user, ...(request.user.role === 'teacher' ? { permissions: getTeacherPermissions(request.user.email) } : {}) } })
})

app.get('/api/admin/courses', requireSession, requireAdmin, (request, response) => {
  response.json({ courses: listCourses('admin', request.user.email) })
})

app.get('/api/teacher/courses', requireSession, (request, response, next) => {
  if (request.user.role !== 'teacher') return next(HttpError(403, 'Teacher access is required.'))
  const assignments = db.prepare(`SELECT course_id AS courseId, chapter_id AS chapterId
    FROM teacher_course_assignments WHERE teacher_email = ?`).all(request.user.email)
  const assignedCourseIds = [...new Set(assignments.map((assignment) => assignment.courseId))]
  const courses = listCourses('teacher', request.user.email)
    .filter((course) => assignedCourseIds.includes(course.id))
    .map((course) => {
      const courseAssignments = assignments.filter((assignment) => assignment.courseId === course.id)
      const courseWide = courseAssignments.some((assignment) => !assignment.chapterId)
      return {
        ...course,
        permissions: getTeacherPermissions(request.user.email),
        chapters: courseWide ? course.chapters : course.chapters.filter((chapter) =>
          courseAssignments.some((assignment) => assignment.chapterId === chapter.id),
        ),
      }
    })
  response.json({ courses, permissions: getTeacherPermissions(request.user.email) })
})

app.get('/api/admin/teachers', requireSession, requireAdmin, (_request, response) => {
  const teachers = db.prepare(`SELECT email, name, phone, active, created_at AS createdAt
    FROM users WHERE role = 'teacher' ORDER BY name COLLATE NOCASE`).all()
    .map((teacher) => ({
      ...teacher,
      active: Boolean(teacher.active),
      permissions: getTeacherPermissions(teacher.email),
      assignments: db.prepare(`SELECT a.id, a.course_id AS courseId, a.chapter_id AS chapterId,
        c.title AS courseTitle, ch.title AS chapterTitle
        FROM teacher_course_assignments a
        JOIN courses c ON c.id = a.course_id
        LEFT JOIN chapters ch ON ch.id = a.chapter_id
        WHERE a.teacher_email = ? ORDER BY c.title, ch.position`).all(teacher.email),
    }))
  response.json({ teachers })
})

app.post('/api/admin/teachers', requireSession, requireAdmin, (request, response, next) => {
  const name = String(request.body?.name || '').trim().slice(0, 100)
  const email = String(request.body?.email || '').trim().toLowerCase()
  const phone = String(request.body?.phone || '').trim().slice(0, 30)
  const password = String(request.body?.password || '')
  if (!name || !email.includes('@') || password.length < 8) {
    return next(HttpError(400, 'Provide a name, valid email, and password with at least 8 characters.'))
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return next(HttpError(409, 'An account with this email already exists.'))
  const { salt, passwordHash } = makePasswordRecord(password)
  const createTeacher = db.transaction(() => {
    db.prepare(`INSERT INTO users (email, name, phone, role, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, 'teacher', ?, ?, ?)`)
      .run(email, name, phone, salt, passwordHash, new Date().toISOString())
    db.prepare('INSERT INTO teacher_permissions (teacher_email) VALUES (?)').run(email)
  })
  createTeacher()
  response.status(201).json({ teacher: { email, name, phone, active: true, permissions: getTeacherPermissions(email), assignments: [] } })
})

app.put('/api/admin/teachers/:email/permissions', requireSession, requireAdmin, (request, response, next) => {
  const email = String(request.params.email || '').trim().toLowerCase()
  if (!db.prepare("SELECT 1 FROM users WHERE email = ? AND role = 'teacher'").get(email)) return next(HttpError(404, 'Teacher was not found.'))
  const provided = request.body?.permissions
  if (!provided || typeof provided !== 'object' || Array.isArray(provided)) return next(HttpError(400, 'Provide a permissions object.'))
  const entries = Object.entries(teacherPermissionColumns)
  for (const [permission, value] of Object.entries(provided)) {
    if (!teacherPermissionColumns[permission] || typeof value !== 'boolean') return next(HttpError(400, `Invalid teacher permission: ${permission}.`))
  }
  const setClause = entries.map(([, column]) => `${column} = ?`).join(', ')
  const values = entries.map(([permission]) => Number(provided[permission] === true))
  db.prepare(`INSERT INTO teacher_permissions (teacher_email) VALUES (?)
    ON CONFLICT(teacher_email) DO NOTHING`).run(email)
  db.prepare(`UPDATE teacher_permissions SET ${setClause} WHERE teacher_email = ?`).run(...values, email)
  response.json({ email, permissions: getTeacherPermissions(email) })
})

app.post('/api/admin/teachers/:email/assignments', requireSession, requireAdmin, (request, response, next) => {
  const email = String(request.params.email || '').trim().toLowerCase()
  const courseId = String(request.body?.courseId || '')
  const chapterId = request.body?.chapterId ? String(request.body.chapterId) : null
  if (!db.prepare("SELECT 1 FROM users WHERE email = ? AND role = 'teacher'").get(email)) return next(HttpError(404, 'Teacher was not found.'))
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  if (chapterId && !db.prepare('SELECT 1 FROM chapters WHERE id = ? AND course_id = ?').get(chapterId, courseId)) {
    return next(HttpError(400, 'The chapter must belong to the selected course.'))
  }
  const existing = db.prepare(`SELECT id FROM teacher_course_assignments
    WHERE teacher_email = ? AND course_id = ? AND COALESCE(chapter_id, '') = COALESCE(?, '')`).get(email, courseId, chapterId)
  if (existing) return response.status(200).json({ assignment: { id: existing.id, email, courseId, chapterId } })
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO teacher_course_assignments (id, teacher_email, course_id, chapter_id, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(id, email, courseId, chapterId, new Date().toISOString())
  response.status(201).json({ assignment: { id, email, courseId, chapterId } })
})

app.delete('/api/admin/teachers/:email/assignments/:assignmentId', requireSession, requireAdmin, (request, response, next) => {
  const result = db.prepare('DELETE FROM teacher_course_assignments WHERE teacher_email = ? AND id = ?')
    .run(String(request.params.email).toLowerCase(), request.params.assignmentId)
  if (!result.changes) return next(HttpError(404, 'Assignment was not found.'))
  response.status(204).end()
})

app.patch('/api/admin/teachers/:email/active', requireSession, requireAdmin, (request, response, next) => {
  const email = String(request.params.email || '').trim().toLowerCase()
  const active = request.body?.active
  if (typeof active !== 'boolean') return next(HttpError(400, 'Active must be true or false.'))
  const result = db.prepare("UPDATE users SET active = ? WHERE email = ? AND role = 'teacher'").run(Number(active), email)
  if (!result.changes) return next(HttpError(404, 'Teacher was not found.'))
  if (!active) db.prepare('DELETE FROM sessions WHERE email = ?').run(email)
  response.json({ email, active })
})

app.get('/api/admin/students', requireSession, requireAdmin, (_request, response) => {
  const students = db.prepare(`SELECT u.email, u.name, u.phone, u.active, u.created_at AS createdAt,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.student_email = u.email AND s.status = 'active' AND s.expires_at > ?) AS activeSubscriptions,
      (SELECT COUNT(*) FROM assessment_attempts aa WHERE aa.student_email = u.email) AS assessmentAttempts,
      (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.student_email = u.email AND lp.completed = 1) AS completedLessons
    FROM users u WHERE u.role = 'student' ORDER BY u.created_at DESC`).all(new Date().toISOString())
    .map((student) => ({ ...student, active: Boolean(student.active) }))
  response.json({ students })
})

app.patch('/api/admin/students/:email/active', requireSession, requireAdmin, (request, response, next) => {
  const email = String(request.params.email || '').trim().toLowerCase()
  const active = request.body?.active
  if (typeof active !== 'boolean') return next(HttpError(400, 'Active must be true or false.'))
  const result = db.prepare("UPDATE users SET active = ? WHERE email = ? AND role = 'student'").run(Number(active), email)
  if (!result.changes) return next(HttpError(404, 'Student was not found.'))
  if (!active) db.prepare('DELETE FROM sessions WHERE email = ?').run(email)
  response.json({ email, active })
})

app.get('/api/student/courses', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  response.json({ courses: listCourses('student', request.user.email) })
})

app.get('/api/teacher/courses/:courseId/chapters/:chapterId/content', requireSession, requireTeacherPermission('uploadVideos'), (request, response, next) => {
  const { courseId, chapterId } = request.params
  if (!db.prepare('SELECT 1 FROM chapters WHERE id = ? AND course_id = ?').get(chapterId, courseId)) return next(HttpError(404, 'Chapter was not found.'))
  const content = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, kind, title,
    original_name AS fileName, mime_type AS mimeType, byte_size AS size, price_pkr AS pricePkr,
    quality, duration, created_by AS createdBy, created_at AS createdAt
    FROM content WHERE course_id = ? AND chapter_id = ? ORDER BY created_at`).all(courseId, chapterId)
  response.json({ content })
})

app.get('/api/student/progress', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const courses = listCourses('student', request.user.email).filter((course) => course.purchased)
  const progress = courses.map((course) => {
    const totalLessons = course.chapters.reduce((total, chapter) => total + chapter.lectures.length, 0)
    const completedLessons = db.prepare(`SELECT COUNT(*) AS count FROM lesson_progress
      WHERE student_email = ? AND course_id = ? AND completed = 1`).get(request.user.email, course.id).count
    const attempts = db.prepare(`SELECT COUNT(*) AS count, COALESCE(AVG(percentage), 0) AS average
      FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
      WHERE aa.student_email = ? AND a.course_id = ? AND aa.submitted_at != ''`).get(request.user.email, course.id)
    return {
      courseId: course.id,
      courseTitle: course.title,
      totalLessons,
      completedLessons,
      percentage: totalLessons ? Math.round(completedLessons / totalLessons * 100) : 0,
      assessmentAttempts: attempts.count,
      averageScore: Math.round(attempts.average),
      subscription: course.subscription,
    }
  })
  response.json({ progress })
})

app.post('/api/student/content/:id/progress', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const item = db.prepare("SELECT id, course_id AS courseId FROM content WHERE id = ? AND kind = 'lecture'").get(request.params.id)
  if (!item) return next(HttpError(404, 'Lecture was not found.'))
  if (!hasApprovedCoursePurchase(request.user.email, item.courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const watchedSeconds = Number(request.body?.watchedSeconds)
  const completed = request.body?.completed
  if (!Number.isSafeInteger(watchedSeconds) || watchedSeconds < 0 || typeof completed !== 'boolean') {
    return next(HttpError(400, 'Provide a non-negative watched time and completion status.'))
  }
  const updatedAt = new Date().toISOString()
  db.prepare(`INSERT INTO lesson_progress (student_email, content_id, course_id, watched_seconds, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_email, content_id) DO UPDATE SET
      watched_seconds = MAX(lesson_progress.watched_seconds, excluded.watched_seconds),
      completed = MAX(lesson_progress.completed, excluded.completed), updated_at = excluded.updated_at`)
    .run(request.user.email, item.id, item.courseId, watchedSeconds, Number(completed), updatedAt)
  response.json({ contentId: item.id, watchedSeconds, completed })
})

app.get('/api/courses/:courseId/assessments', requireSession, (request, response, next) => {
  const courseId = request.params.courseId
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  if (request.user.role === 'teacher' && !hasTeacherCourseAssignment(request.user.email, courseId)) {
    return next(HttpError(403, 'This course is not assigned to your account.'))
  }
  const assessments = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, title, kind,
      duration_minutes AS durationMinutes, published, randomize, is_free AS isFree, created_by AS createdBy, created_at AS createdAt
    FROM assessments WHERE course_id = ? ${request.user.role === 'student' ? 'AND published = 1' : ''}
    ORDER BY created_at DESC`).all(courseId).map((assessment) => {
      const locked = request.user.role === 'student' && !studentCanAccessCoursework(request.user.email, courseId, assessment.isFree)
      const questions = locked
        ? []
        : db.prepare(`SELECT id, prompt, options_json AS optionsJson, position, ${request.user.role === 'student' ? "NULL AS correctIndex" : 'correct_index AS correctIndex'}
          FROM assessment_questions WHERE assessment_id = ? ORDER BY position`).all(assessment.id)
          .map((question) => ({ ...question, options: JSON.parse(question.optionsJson) }))
      const questionCount = db.prepare('SELECT COUNT(*) AS count FROM assessment_questions WHERE assessment_id = ?').get(assessment.id).count
      return {
        ...assessment,
        published: Boolean(assessment.published),
        randomize: Boolean(assessment.randomize),
        isFree: Boolean(assessment.isFree),
        locked,
        questionCount,
        questions,
        attempts: request.user.role === 'student' && !locked
          ? db.prepare(`SELECT id, score, total, percentage, submitted_at AS submittedAt
            FROM assessment_attempts WHERE assessment_id = ? AND student_email = ? ORDER BY submitted_at DESC`)
            .all(assessment.id, request.user.email)
          : request.user.role === 'student' ? [] : undefined,
      }
    })
  response.json({ assessments })
})

app.post('/api/courses/:courseId/assessments', requireSession, (request, response, next) => {
  const { courseId } = request.params
  const kind = request.body?.kind
  const permission = kind === 'test' ? 'createTests' : 'createQuizzes'
  if (!['quiz', 'test'].includes(kind)) return next(HttpError(400, 'Assessment type must be a quiz or test.'))
  if (!canManageAssignedCourse(request, courseId, request.body?.chapterId || null, permission)) {
    return next(HttpError(403, `The owner has not granted permission to create ${kind}s for this course.`))
  }
  const title = String(request.body?.title || '').trim()
  const chapterId = request.body?.chapterId ? String(request.body.chapterId) : null
  const durationMinutes = Number(request.body?.durationMinutes || 0)
  const questions = request.body?.questions
  if (!title || title.length > 180 || !Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 360) {
    return next(HttpError(400, 'Provide a title and a time limit from 0 to 360 minutes.'))
  }
  if (chapterId && !db.prepare('SELECT 1 FROM chapters WHERE id = ? AND course_id = ?').get(chapterId, courseId)) {
    return next(HttpError(400, 'The chapter must belong to this course.'))
  }
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 200) {
    return next(HttpError(400, 'An assessment must contain between 1 and 200 questions.'))
  }
  const normalized = []
  for (const question of questions) {
    const prompt = String(question?.prompt || '').trim()
    const options = question?.options
    const correctIndex = Number(question?.correctIndex)
    if (!prompt || prompt.length > 1000 || !Array.isArray(options) || options.length < 2 || options.length > 8
      || options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 300)
      || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return next(HttpError(400, 'Each multiple-choice question needs a prompt, 2–8 options, and a valid correct option.'))
    }
    normalized.push({ prompt, options: options.map((option) => option.trim()), correctIndex })
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const isFree = Boolean(request.body?.isFree)
  const create = db.transaction(() => {
    db.prepare(`INSERT INTO assessments (id, course_id, chapter_id, title, kind, duration_minutes, randomize, is_free, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, courseId, chapterId, title, kind, durationMinutes, Number(Boolean(request.body?.randomize)), Number(isFree), request.user.email, createdAt)
    const insertQuestion = db.prepare(`INSERT INTO assessment_questions (id, assessment_id, prompt, options_json, correct_index, position)
      VALUES (?, ?, ?, ?, ?, ?)`)
    normalized.forEach((question, index) => insertQuestion.run(crypto.randomUUID(), id, question.prompt, JSON.stringify(question.options), question.correctIndex, index))
  })
  create()
  response.status(201).json({ assessment: { id, courseId, chapterId, title, kind, durationMinutes, published: false, randomize: Boolean(request.body?.randomize), isFree, createdAt } })
})

app.patch('/api/assessments/:id/publish', requireSession, (request, response, next) => {
  const assessment = db.prepare('SELECT id, course_id AS courseId, chapter_id AS chapterId, kind, created_by AS createdBy FROM assessments WHERE id = ?').get(request.params.id)
  if (!assessment) return next(HttpError(404, 'Assessment was not found.'))
  const permission = assessment.kind === 'test' ? 'createTests' : 'createQuizzes'
  if (request.user.role !== 'admin' && (
    assessment.createdBy !== request.user.email
    || !canManageAssignedCourse(request, assessment.courseId, assessment.chapterId, permission)
  )) return next(HttpError(403, 'You cannot publish this assessment.'))
  const published = request.body?.published
  if (typeof published !== 'boolean') return next(HttpError(400, 'Published must be true or false.'))
  db.prepare('UPDATE assessments SET published = ? WHERE id = ?').run(Number(published), assessment.id)
  if (published) {
    const title = db.prepare('SELECT title FROM assessments WHERE id = ?').get(assessment.id).title
    notifyCourseStudents(assessment.courseId, assessment.kind === 'test' ? 'New course test' : 'New course quiz', `${title} is ready to take.`)
  }
  response.json({ assessmentId: assessment.id, published })
})

app.post('/api/assessments/:id/attempts', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const assessment = db.prepare(`SELECT a.*, c.published AS course_published FROM assessments a
    JOIN courses c ON c.id = a.course_id WHERE a.id = ? AND a.published = 1`).get(request.params.id)
  if (!assessment) return next(HttpError(404, 'Published assessment was not found.'))
  if (!studentCanAccessCoursework(request.user.email, assessment.course_id, assessment.is_free)) {
    return next(HttpError(402, 'Purchase this course or wait for a free quiz to be published.'))
  }
  const questions = db.prepare(`SELECT id, prompt, options_json AS optionsJson, correct_index AS correctIndex
    FROM assessment_questions WHERE assessment_id = ? ORDER BY position`).all(assessment.id)
  const ordered = assessment.randomize ? shuffle(questions) : questions
  const attemptId = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const createAttempt = db.transaction(() => {
    db.prepare(`INSERT INTO assessment_attempts (id, assessment_id, student_email, answers_json, score, total, percentage, started_at, submitted_at)
      VALUES (?, ?, ?, '{}', 0, ?, 0, ?, '')`).run(attemptId, assessment.id, request.user.email, questions.length, startedAt)
    const insertShownQuestion = db.prepare(`INSERT INTO assessment_attempt_questions
      (attempt_id, question_id, displayed_options_json, displayed_correct_index, position) VALUES (?, ?, ?, ?, ?)`)
    ordered.forEach((question, position) => {
      const options = JSON.parse(question.optionsJson)
      const indexed = options.map((text, originalIndex) => ({ text, originalIndex }))
      const displayed = assessment.randomize ? shuffle(indexed) : indexed
      insertShownQuestion.run(attemptId, question.id, JSON.stringify(displayed.map((item) => item.text)),
        displayed.findIndex((item) => item.originalIndex === question.correctIndex), position)
    })
  })
  createAttempt()
  response.status(201).json({
    attemptId,
    startedAt,
    durationMinutes: assessment.duration_minutes,
    questions: db.prepare(`SELECT aq.question_id AS id, q.prompt, aq.displayed_options_json AS optionsJson
      FROM assessment_attempt_questions aq JOIN assessment_questions q ON q.id = aq.question_id
      WHERE aq.attempt_id = ? ORDER BY aq.position`).all(attemptId).map((question) => ({ id: question.id, prompt: question.prompt, options: JSON.parse(question.optionsJson) })),
  })
})

app.post('/api/assessment-attempts/:attemptId/submit', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const attempt = db.prepare(`SELECT aa.*, a.duration_minutes AS durationMinutes, a.course_id AS courseId
    FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
    WHERE aa.id = ? AND aa.student_email = ?`).get(request.params.attemptId, request.user.email)
  if (!attempt) return next(HttpError(404, 'Assessment attempt was not found.'))
  if (attempt.submitted_at) return next(HttpError(409, 'This assessment attempt has already been submitted.'))
  if (attempt.durationMinutes > 0 && Date.now() > new Date(attempt.started_at).getTime() + attempt.durationMinutes * 60 * 1000 + 5000) {
    return next(HttpError(409, 'The time limit for this assessment has expired.'))
  }
  const answers = request.body?.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return next(HttpError(400, 'Provide an answer for each question.'))
  const questions = db.prepare(`SELECT question_id AS questionId, displayed_correct_index AS correctIndex
    FROM assessment_attempt_questions WHERE attempt_id = ? ORDER BY position`).all(attempt.id)
  let score = 0
  const review = questions.map((question) => {
    const submitted = answers[question.questionId]
    const hasSelection = Object.hasOwn(answers, question.questionId) && Number.isInteger(submitted)
    const correct = hasSelection && submitted === question.correctIndex
    if (correct) score += 1
    return { questionId: question.questionId, selectedIndex: hasSelection ? submitted : null, correctIndex: question.correctIndex, correct }
  })
  const total = questions.length
  const percentage = total ? Math.round(score / total * 100) : 0
  const submittedAt = new Date().toISOString()
  db.prepare(`UPDATE assessment_attempts SET answers_json = ?, score = ?, total = ?, percentage = ?, submitted_at = ?
    WHERE id = ? AND submitted_at = ''`)
    .run(JSON.stringify(answers), score, total, percentage, submittedAt, attempt.id)
  response.json({ attemptId: attempt.id, score, total, percentage, review, submittedAt })
})

app.get('/api/courses/:courseId/assignments', requireSession, (request, response, next) => {
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(request.params.courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  if (request.user.role === 'teacher') {
    if (!canManageAssignedCourse(request, course.id, null, 'manageAssignments')) {
      return next(HttpError(403, 'Assignment access is not enabled for this assigned course.'))
    }
  } else if (request.user.role !== 'admin' && request.user.role !== 'student') {
    return next(HttpError(403, 'Assignment access is not available for this account.'))
  }

  let assignments = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, title,
      instructions, due_at AS dueAt, points, published, is_free AS isFree, created_by AS createdBy, created_at AS createdAt
    FROM course_assignments WHERE course_id = ? ${request.user.role === 'student' ? 'AND published = 1' : ''}
    ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, created_at DESC`).all(course.id)
  if (request.user.role === 'teacher') {
    assignments = assignments.filter((assignment) =>
      canManageAssignedCourse(request, course.id, assignment.chapterId, 'manageAssignments'),
    )
  }
  const submissions = db.prepare(`SELECT s.id, s.assignment_id AS assignmentId, s.student_email AS studentEmail,
      u.name AS studentName, s.answer, s.submitted_at AS submittedAt, s.grade, s.feedback,
      s.reviewed_by AS reviewedBy, s.reviewed_at AS reviewedAt
    FROM assignment_submissions s LEFT JOIN users u ON u.email = s.student_email
    WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC`)
  const ownSubmission = db.prepare(`SELECT id, assignment_id AS assignmentId, answer,
      submitted_at AS submittedAt, grade, feedback, reviewed_at AS reviewedAt
    FROM assignment_submissions WHERE assignment_id = ? AND student_email = ?`)
  response.json({
    assignments: assignments.map((assignment) => {
      const locked = request.user.role === 'student' && !studentCanAccessCoursework(request.user.email, course.id, assignment.isFree)
      return {
        ...assignment,
        published: Boolean(assignment.published),
        isFree: Boolean(assignment.isFree),
        locked,
        instructions: locked ? 'Purchase this course to view the full assignment instructions.' : assignment.instructions,
        submission: request.user.role === 'student' && !locked ? ownSubmission.get(assignment.id, request.user.email) || null : null,
        submissions: request.user.role === 'student' ? [] : submissions.all(assignment.id),
      }
    }),
  })
})

app.post('/api/courses/:courseId/assignments', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  if (!canManageAssignedCourse(request, courseId, request.body?.chapterId || null, 'manageAssignments')) {
    return next(HttpError(403, 'The owner has not granted assignment management access for this course or chapter.'))
  }
  const title = String(request.body?.title || '').trim()
  const instructions = String(request.body?.instructions || '').trim()
  const chapterId = request.body?.chapterId ? String(request.body.chapterId) : null
  const dueAtValue = request.body?.dueAt ? String(request.body.dueAt) : ''
  const points = Number(request.body?.points ?? 100)
  if (!title || title.length > 180 || instructions.length > 10000 || !Number.isSafeInteger(points) || points < 1 || points > 10000) {
    return next(HttpError(400, 'Provide a title, instructions under 10,000 characters, and points between 1 and 10,000.'))
  }
  if (chapterId && (!safeId(chapterId) || !db.prepare('SELECT 1 FROM chapters WHERE id = ? AND course_id = ?').get(chapterId, courseId))) {
    return next(HttpError(400, 'The chapter must belong to this course.'))
  }
  const dueAt = dueAtValue ? new Date(dueAtValue) : null
  if (dueAtValue && !Number.isFinite(dueAt.getTime())) return next(HttpError(400, 'Provide a valid assignment due date.'))
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const isFree = Boolean(request.body?.isFree)
  db.prepare(`INSERT INTO course_assignments
    (id, course_id, chapter_id, title, instructions, due_at, points, published, is_free, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(id, courseId, chapterId, title, instructions, dueAt?.toISOString() || null, points, Number(isFree), request.user.email, createdAt)
  response.status(201).json({
    assignment: { id, courseId, chapterId, title, instructions, dueAt: dueAt?.toISOString() || null, points, published: false, isFree, createdBy: request.user.email, createdAt },
  })
})

app.patch('/api/assignments/:assignmentId/publish', requireSession, (request, response, next) => {
  const assignment = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId,
      title, created_by AS createdBy FROM course_assignments WHERE id = ?`).get(request.params.assignmentId)
  if (!assignment) return next(HttpError(404, 'Assignment was not found.'))
  if (request.user.role !== 'admin' && (
    request.user.email !== assignment.createdBy
    || !canManageAssignedCourse(request, assignment.courseId, assignment.chapterId, 'manageAssignments')
  )) return next(HttpError(403, 'You cannot publish this assignment.'))
  if (typeof request.body?.published !== 'boolean') return next(HttpError(400, 'Published must be true or false.'))
  db.prepare('UPDATE course_assignments SET published = ? WHERE id = ?').run(Number(request.body.published), assignment.id)
  if (request.body.published) notifyCourseStudents(assignment.courseId, 'New course assignment', `${assignment.title} is ready to complete.`)
  response.json({ assignmentId: assignment.id, published: request.body.published })
})

app.post('/api/assignments/:assignmentId/submissions', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const assignment = db.prepare(`SELECT id, course_id AS courseId, title, due_at AS dueAt, published, is_free
    FROM course_assignments WHERE id = ?`).get(request.params.assignmentId)
  if (!assignment || !assignment.published) return next(HttpError(404, 'Published assignment was not found.'))
  if (!studentCanAccessCoursework(request.user.email, assignment.courseId, assignment.is_free)) {
    return next(HttpError(402, 'Purchase this course or wait for a free assignment to be published.'))
  }
  const answer = String(request.body?.answer || '').trim()
  if (!answer || answer.length > 20000) return next(HttpError(400, 'A submission between 1 and 20,000 characters is required.'))
  const existing = db.prepare('SELECT id, grade FROM assignment_submissions WHERE assignment_id = ? AND student_email = ?')
    .get(assignment.id, request.user.email)
  if (existing?.grade !== null && existing?.grade !== undefined) {
    return next(HttpError(409, 'This submission has already been graded and cannot be replaced.'))
  }
  const id = existing?.id || crypto.randomUUID()
  const submittedAt = new Date().toISOString()
  db.prepare(`INSERT INTO assignment_submissions (id, assignment_id, student_email, answer, submitted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(assignment_id, student_email) DO UPDATE SET
      answer = excluded.answer, submitted_at = excluded.submitted_at, grade = NULL,
      feedback = '', reviewed_by = NULL, reviewed_at = NULL`)
    .run(id, assignment.id, request.user.email, answer, submittedAt)
  db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    db.prepare('SELECT created_by FROM course_assignments WHERE id = ?').get(assignment.id).created_by,
    'Assignment submitted',
    `A student submitted work for ${assignment.title}.`,
    submittedAt,
  )
  response.status(201).json({
    submission: {
      id, assignmentId: assignment.id, answer, submittedAt,
      late: Boolean(assignment.dueAt && submittedAt > assignment.dueAt),
    },
  })
})

app.patch('/api/assignments/:assignmentId/submissions/:submissionId/review', requireSession, (request, response, next) => {
  const assignment = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId,
      title, points FROM course_assignments WHERE id = ?`).get(request.params.assignmentId)
  if (!assignment) return next(HttpError(404, 'Assignment was not found.'))
  if (!canManageAssignedCourse(request, assignment.courseId, assignment.chapterId, 'manageAssignments')) {
    return next(HttpError(403, 'The owner has not granted assignment review access for this course or chapter.'))
  }
  const submission = db.prepare(`SELECT id, student_email AS studentEmail FROM assignment_submissions
    WHERE id = ? AND assignment_id = ?`).get(request.params.submissionId, assignment.id)
  if (!submission) return next(HttpError(404, 'Assignment submission was not found.'))
  const grade = Number(request.body?.grade)
  const feedback = String(request.body?.feedback || '').trim()
  if (!Number.isFinite(grade) || grade < 0 || grade > assignment.points || feedback.length > 5000) {
    return next(HttpError(400, `Provide a grade between 0 and ${assignment.points} and feedback under 5,000 characters.`))
  }
  const reviewedAt = new Date().toISOString()
  db.prepare(`UPDATE assignment_submissions SET grade = ?, feedback = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(grade, feedback, request.user.email, reviewedAt, submission.id)
  db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), submission.studentEmail, 'Assignment reviewed',
    `Your submission for ${assignment.title} received ${grade} out of ${assignment.points} points.${feedback ? ` Feedback: ${feedback}` : ''}`,
    reviewedAt,
  )
  response.json({ submissionId: submission.id, grade, feedback, reviewedBy: request.user.email, reviewedAt })
})

app.get('/api/student/live-classes', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const classes = db.prepare(`SELECT lc.id, lc.course_id AS courseId, c.title AS courseTitle,
      lc.chapter_id AS chapterId, ch.title AS chapterTitle, lc.title, lc.starts_at AS startsAt,
      lc.meeting_url AS meetingUrl, lc.recording_content_id AS recordingContentId, recording.title AS recordingTitle,
      (SELECT attended FROM live_class_attendance a WHERE a.live_class_id = lc.id AND a.student_email = ?) AS attended
    FROM live_classes lc JOIN courses c ON c.id = lc.course_id
    LEFT JOIN chapters ch ON ch.id = lc.chapter_id
    LEFT JOIN content recording ON recording.id = lc.recording_content_id
    WHERE lc.starts_at > ? AND EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.student_email = ? AND s.course_id = lc.course_id
        AND s.status = 'active' AND s.expires_at > ?
      UNION SELECT 1 FROM purchases p WHERE p.student_email = ? AND p.course_id = lc.course_id AND p.status = 'paid'
    )
    ORDER BY lc.starts_at`).all(request.user.email, new Date().toISOString(), request.user.email,
    new Date().toISOString(), request.user.email)
  response.json({ classes })
})

app.get('/api/student/live-class-recordings', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const recordings = db.prepare(`SELECT lc.id AS liveClassId, lc.course_id AS courseId, c.title AS courseTitle,
      lc.chapter_id AS chapterId, ch.title AS chapterTitle, lc.title, lc.starts_at AS startsAt,
      lc.recording_content_id AS recordingContentId, recording.title AS recordingTitle
    FROM live_classes lc
    JOIN courses c ON c.id = lc.course_id
    JOIN content recording ON recording.id = lc.recording_content_id AND recording.kind = 'lecture'
    LEFT JOIN chapters ch ON ch.id = lc.chapter_id
    WHERE lc.starts_at <= ? AND EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.student_email = ? AND s.course_id = lc.course_id
        AND s.status = 'active' AND s.expires_at > ?
      UNION SELECT 1 FROM purchases p WHERE p.student_email = ? AND p.course_id = lc.course_id AND p.status = 'paid'
    )
    ORDER BY lc.starts_at DESC`).all(new Date().toISOString(), request.user.email,
    new Date().toISOString(), request.user.email)
  response.json({ recordings })
})

app.get('/api/student/attendance', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const attendance = db.prepare(`SELECT lc.id AS liveClassId, lc.title, lc.course_id AS courseId,
      c.title AS courseTitle, lc.chapter_id AS chapterId, ch.title AS chapterTitle,
      lc.starts_at AS startsAt, a.attended, a.marked_at AS markedAt
    FROM live_class_attendance a
    JOIN live_classes lc ON lc.id = a.live_class_id
    JOIN courses c ON c.id = lc.course_id
    LEFT JOIN chapters ch ON ch.id = lc.chapter_id
    WHERE a.student_email = ? AND a.attended = 1
    ORDER BY lc.starts_at DESC`).all(request.user.email)
  response.json({ attendance })
})

app.get('/api/admin/live-classes', requireSession, requireAdmin, (_request, response) => {
  const classes = db.prepare(`SELECT lc.id, lc.course_id AS courseId, c.title AS courseTitle,
      lc.chapter_id AS chapterId, ch.title AS chapterTitle, lc.title, lc.starts_at AS startsAt,
      lc.meeting_url AS meetingUrl, lc.recording_content_id AS recordingContentId,
      recording.title AS recordingTitle, lc.created_by AS createdBy
    FROM live_classes lc JOIN courses c ON c.id = lc.course_id
    LEFT JOIN content recording ON recording.id = lc.recording_content_id
    LEFT JOIN chapters ch ON ch.id = lc.chapter_id ORDER BY lc.starts_at DESC`).all()
  response.json({ classes })
})

app.delete('/api/admin/live-classes/:id', requireSession, requireAdmin, (request, response, next) => {
  const result = db.prepare('DELETE FROM live_classes WHERE id = ?').run(request.params.id)
  if (!result.changes) return next(HttpError(404, 'Live class was not found.'))
  db.prepare('DELETE FROM live_class_attendance WHERE live_class_id = ?').run(request.params.id)
  response.status(204).end()
})

app.post('/api/courses/:courseId/live-classes', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (!canManageAssignedCourse(request, courseId, request.body?.chapterId || null, 'scheduleLiveClasses')) {
    return next(HttpError(403, 'The owner has not granted live-class scheduling access for this course.'))
  }
  const title = String(request.body?.title || '').trim()
  const startsAt = String(request.body?.startsAt || '')
  const meetingUrl = String(request.body?.meetingUrl || '').trim()
  const chapterId = request.body?.chapterId ? String(request.body.chapterId) : null
  let parsedUrl
  try { parsedUrl = new URL(meetingUrl) } catch { return next(HttpError(400, 'Provide a valid Zoom, Meet, or HTTPS meeting link.')) }
  if (!title || title.length > 180 || !Number.isFinite(Date.parse(startsAt)) || !['https:', 'http:'].includes(parsedUrl.protocol)) {
    return next(HttpError(400, 'Provide a class title, valid start time, and HTTP(S) meeting link.'))
  }
  if (chapterId && !db.prepare('SELECT 1 FROM chapters WHERE id = ? AND course_id = ?').get(chapterId, courseId)) {
    return next(HttpError(400, 'The chapter must belong to this course.'))
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(`INSERT INTO live_classes (id, course_id, chapter_id, title, starts_at, meeting_url, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, courseId, chapterId, title, new Date(startsAt).toISOString(), meetingUrl, request.user.email, createdAt)
  notifyCourseStudents(courseId, 'Upcoming live class', `${title} starts ${new Date(startsAt).toLocaleString()}.`)
  response.status(201).json({ liveClass: { id, courseId, chapterId, title, startsAt: new Date(startsAt).toISOString(), meetingUrl, createdAt } })
})

app.get('/api/teacher/courses/:courseId/live-classes', requireSession, (request, response, next) => {
  const permissions = request.user.role === 'teacher' ? getTeacherPermissions(request.user.email) : null
  if (request.user.role !== 'teacher' || !hasTeacherCourseAssignment(request.user.email, request.params.courseId)
    || (!permissions.scheduleLiveClasses && !permissions.viewAttendance && !permissions.uploadVideos)) {
    return next(HttpError(403, 'Live-class access is not enabled for this assigned course.'))
  }
  const classes = db.prepare(`SELECT lc.id, lc.course_id AS courseId, lc.chapter_id AS chapterId,
      lc.title, lc.starts_at AS startsAt, lc.meeting_url AS meetingUrl,
      lc.recording_content_id AS recordingContentId, recording.title AS recordingTitle
    FROM live_classes lc LEFT JOIN content recording ON recording.id = lc.recording_content_id
    WHERE lc.course_id = ? ORDER BY lc.starts_at`)
    .all(request.params.courseId)
  response.json({ classes })
})

app.patch('/api/live-classes/:id/recording', requireSession, (request, response, next) => {
  const liveClass = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId,
      recording_content_id AS recordingContentId, title FROM live_classes WHERE id = ?`)
    .get(request.params.id)
  if (!liveClass) return next(HttpError(404, 'Live class was not found.'))

  const contentId = request.body?.contentId ? String(request.body.contentId).trim() : null
  let recording = null
  if (contentId) {
    if (!safeId(contentId)) return next(HttpError(400, 'Invalid recording content id.'))
    recording = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, title
      FROM content WHERE id = ? AND kind = 'lecture'`).get(contentId)
    if (!recording) return next(HttpError(404, 'Recorded lecture was not found.'))
    if (recording.courseId !== liveClass.courseId || (liveClass.chapterId && recording.chapterId !== liveClass.chapterId)) {
      return next(HttpError(400, 'The recording must be a lecture in the same course and, when selected, the same chapter.'))
    }
  }

  const existingRecording = liveClass.chapterId
    ? null
    : liveClass.recordingContentId
      ? db.prepare('SELECT chapter_id AS chapterId FROM content WHERE id = ?').get(liveClass.recordingContentId)
      : null
  const permissionChapterId = recording?.chapterId || liveClass.chapterId || existingRecording?.chapterId || null
  if (!canManageAssignedCourse(request, liveClass.courseId, permissionChapterId, 'uploadVideos')) {
    return next(HttpError(403, 'The owner has not granted recording management access for this course or chapter.'))
  }

  db.prepare('UPDATE live_classes SET recording_content_id = ? WHERE id = ?').run(recording?.id || null, liveClass.id)
  if (recording) notifyCourseStudents(liveClass.courseId, 'Live class recording available', `${liveClass.title} is now available as a course lecture.`)
  response.json({
    liveClassId: liveClass.id,
    recordingContentId: recording?.id || null,
    recordingTitle: recording?.title || null,
  })
})

app.post('/api/live-classes/:id/attendance', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const liveClass = db.prepare('SELECT id, course_id AS courseId, starts_at AS startsAt FROM live_classes WHERE id = ?').get(request.params.id)
  if (!liveClass) return next(HttpError(404, 'Live class was not found.'))
  if (!hasApprovedCoursePurchase(request.user.email, liveClass.courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const now = Date.now()
  const classStart = new Date(liveClass.startsAt).getTime()
  if (now < classStart - 15 * 60 * 1000 || now > classStart + 3 * 60 * 60 * 1000) {
    return next(HttpError(409, 'Attendance can be marked from 15 minutes before the class until 3 hours after it starts.'))
  }
  const markedAt = new Date().toISOString()
  db.prepare(`INSERT INTO live_class_attendance (live_class_id, student_email, attended, marked_by, marked_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(live_class_id, student_email) DO UPDATE SET attended = 1, marked_at = excluded.marked_at`)
    .run(liveClass.id, request.user.email, request.user.email, markedAt)
  response.json({ liveClassId: liveClass.id, attended: true })
})

app.get('/api/live-classes/:id/attendance', requireSession, (request, response, next) => {
  const liveClass = db.prepare('SELECT id, course_id AS courseId, chapter_id AS chapterId FROM live_classes WHERE id = ?').get(request.params.id)
  if (!liveClass) return next(HttpError(404, 'Live class was not found.'))
  if (request.user.role !== 'admin' && !canManageAssignedCourse(request, liveClass.courseId, liveClass.chapterId, 'viewAttendance')) {
    return next(HttpError(403, 'The owner has not granted attendance access for this course.'))
  }
  const attendance = db.prepare(`SELECT u.email AS studentEmail, u.name, COALESCE(a.attended, 0) AS attended, a.marked_at AS markedAt
    FROM users u LEFT JOIN live_class_attendance a ON a.student_email = u.email AND a.live_class_id = ?
    WHERE u.role = 'student' AND u.active = 1 AND (
      EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_email = u.email AND s.course_id = ?
        AND s.status = 'active' AND s.expires_at > ?)
      OR EXISTS (SELECT 1 FROM purchases p WHERE p.student_email = u.email AND p.course_id = ? AND p.status = 'paid')
    ) ORDER BY u.name`).all(liveClass.id, liveClass.courseId, new Date().toISOString(), liveClass.courseId)
  response.json({ attendance })
})

app.post('/api/announcements', requireSession, (request, response, next) => {
  const courseId = request.body?.courseId ? String(request.body.courseId) : null
  const title = String(request.body?.title || '').trim()
  const body = String(request.body?.body || '').trim()
  if (!title || title.length > 180 || !body || body.length > 5000) return next(HttpError(400, 'Provide an announcement title and message.'))
  if (courseId && !db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  if (request.user.role === 'teacher' && (
    !courseId
    || !canManageAssignedCourse(request, courseId, null, 'sendAnnouncements')
  )) return next(HttpError(403, 'The owner has not granted announcement access for this course.'))
  if (request.user.role === 'student') return next(HttpError(403, 'Only the owner or an authorized teacher can send announcements.'))
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const recipients = db.prepare("SELECT email FROM users WHERE role = 'student' AND active = 1").all()
  const create = db.transaction(() => {
    db.prepare('INSERT INTO announcements (id, course_id, title, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, courseId, title, body, request.user.email, createdAt)
    const addNotification = db.prepare(`INSERT INTO notifications (id, recipient_email, announcement_id, title, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    for (const recipient of recipients) {
      if (courseId && !hasApprovedCoursePurchase(recipient.email, courseId)) continue
      addNotification.run(crypto.randomUUID(), recipient.email, id, title, body, createdAt)
    }
  })
  create()
  response.status(201).json({ announcement: { id, courseId, title, body, createdAt } })
})

app.get('/api/student/notifications', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const notifications = db.prepare(`SELECT id, title, body, created_at AS createdAt, read_at AS readAt
    FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 100`).all(request.user.email)
  response.json({ notifications })
})

app.get('/api/notifications', requireSession, (request, response) => {
  const notifications = db.prepare(`SELECT id, title, body, created_at AS createdAt, read_at AS readAt
    FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 100`).all(request.user.email)
  response.json({ notifications })
})

app.patch('/api/notifications/:id/read', requireSession, (request, response, next) => {
  const result = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_email = ?')
    .run(new Date().toISOString(), request.params.id, request.user.email)
  if (!result.changes) return next(HttpError(404, 'Notification was not found.'))
  response.json({ id: request.params.id, read: true })
})

app.patch('/api/student/notifications/:id/read', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const result = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_email = ?')
    .run(new Date().toISOString(), request.params.id, request.user.email)
  if (!result.changes) return next(HttpError(404, 'Notification was not found.'))
  response.json({ id: request.params.id, read: true })
})

app.post('/api/student/feedback', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const courseId = String(request.body?.courseId || '')
  const contentId = request.body?.contentId ? String(request.body.contentId) : null
  const teacherEmail = request.body?.teacherEmail ? String(request.body.teacherEmail).trim().toLowerCase() : null
  const rating = Number(request.body?.rating)
  const comment = String(request.body?.comment || '').trim()
  if (!hasApprovedCoursePurchase(request.user.email, courseId)) return next(HttpError(402, 'An active course subscription is required to leave feedback.'))
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 5000) return next(HttpError(400, 'Rating must be from 1 to 5 and comments under 5000 characters.'))
  if (contentId && !db.prepare('SELECT 1 FROM content WHERE id = ? AND course_id = ?').get(contentId, courseId)) return next(HttpError(400, 'The lecture must belong to the selected course.'))
  if (teacherEmail && !db.prepare("SELECT 1 FROM users WHERE email = ? AND role = 'teacher'").get(teacherEmail)) return next(HttpError(400, 'The selected teacher account does not exist.'))
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO feedback (id, student_email, course_id, content_id, teacher_email, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, request.user.email, courseId, contentId, teacherEmail, rating, comment, new Date().toISOString())
  response.status(201).json({ feedback: { id, courseId, contentId, teacherEmail, rating, comment } })
})

app.get('/api/courses/:courseId/teachers', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  if (!hasApprovedCoursePurchase(request.user.email, courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const teachers = db.prepare(`SELECT DISTINCT u.email, u.name
    FROM teacher_course_assignments a JOIN users u ON u.email = a.teacher_email
    WHERE a.course_id = ? AND u.active = 1 ORDER BY u.name`).all(courseId)
  response.json({ teachers })
})

function canAccessCourseCommunity(request, courseId) {
  if (request.user.role === 'admin') return true
  if (request.user.role === 'student') return hasApprovedCoursePurchase(request.user.email, courseId)
  return hasTeacherCourseAssignment(request.user.email, courseId)
}

app.get('/api/courses/:courseId/discussions', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  if (!canAccessCourseCommunity(request, courseId)) return next(HttpError(403, 'An active course subscription or course assignment is required.'))
  const posts = db.prepare(`SELECT p.id, p.parent_id AS parentId, u.name AS authorName,
      p.title, p.body, p.status, p.created_at AS createdAt
    FROM discussion_posts p JOIN users u ON u.email = p.author_email
    WHERE p.course_id = ? ORDER BY p.created_at`).all(courseId)
  const children = db.prepare(`SELECT p.id, p.parent_id AS parentId,
      u.name AS authorName, p.body, p.created_at AS createdAt
    FROM discussion_posts p JOIN users u ON u.email = p.author_email
    WHERE p.parent_id IS NOT NULL AND p.course_id = ? ORDER BY p.created_at`)
  response.json({ discussions: posts.filter((post) => !post.parentId).map((post) => ({
    ...post,
    replies: children.all(courseId).filter((reply) => reply.parentId === post.id),
  })) })
})

app.post('/api/courses/:courseId/discussions', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (!canAccessCourseCommunity(request, courseId)) return next(HttpError(403, 'An active course subscription or course assignment is required.'))
  const parentId = request.body?.parentId ? String(request.body.parentId) : null
  const title = String(request.body?.title || '').trim()
  const body = String(request.body?.body || '').trim()
  if (parentId && !db.prepare("SELECT 1 FROM discussion_posts WHERE id = ? AND course_id = ? AND parent_id IS NULL").get(parentId, courseId)) {
    return next(HttpError(400, 'Replies must belong to a discussion in this course.'))
  }
  if ((!parentId && !title) || title.length > 180 || !body || body.length > 5000) {
    return next(HttpError(400, 'A new discussion needs a title; all posts need a message under 5,000 characters.'))
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(`INSERT INTO discussion_posts (id, course_id, parent_id, author_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, courseId, parentId, request.user.email, parentId ? '' : title, body, createdAt)
  response.status(201).json({ post: { id, courseId, parentId, authorEmail: request.user.email, title, body, status: 'open', createdAt } })
})

app.patch('/api/discussions/:id/status', requireSession, (request, response, next) => {
  const post = db.prepare('SELECT id, course_id AS courseId FROM discussion_posts WHERE id = ? AND parent_id IS NULL').get(request.params.id)
  if (!post) return next(HttpError(404, 'Discussion was not found.'))
  if (!canManageAssignedCourse(request, post.courseId, null, 'manageDiscussions')) {
    return next(HttpError(403, 'Only the owner or a teacher with discussion-management permission can moderate discussions.'))
  }
  if (!['open', 'resolved'].includes(request.body?.status)) return next(HttpError(400, 'Status must be open or resolved.'))
  db.prepare('UPDATE discussion_posts SET status = ? WHERE id = ?').run(request.body.status, post.id)
  response.json({ id: post.id, status: request.body.status })
})

app.get('/api/student/courses/:courseId/questions/teachers', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  if (!hasApprovedCoursePurchase(request.user.email, request.params.courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const teachers = db.prepare(`SELECT DISTINCT u.email, u.name FROM teacher_course_assignments a
    JOIN users u ON u.email = a.teacher_email JOIN teacher_permissions p ON p.teacher_email = u.email
    WHERE a.course_id = ? AND u.active = 1 AND p.manage_messages = 1 ORDER BY u.name`).all(request.params.courseId)
  response.json({ teachers })
})

function canAccessQuestion(request, question) {
  return request.user.role === 'admin'
    || (request.user.role === 'student' && question.studentEmail === request.user.email)
    || (request.user.role === 'teacher' && question.teacherEmail === request.user.email
      && getTeacherPermissions(request.user.email).manageMessages
      && hasTeacherCourseAssignment(request.user.email, question.courseId))
}

app.get('/api/questions', requireSession, (request, response, next) => {
  if (!['admin', 'teacher', 'student'].includes(request.user.role)) return next(HttpError(403, 'Question access is not permitted.'))
  const rows = request.user.role === 'admin'
    ? db.prepare(`SELECT q.*, c.title AS courseTitle FROM student_questions q JOIN courses c ON c.id = q.course_id ORDER BY q.updated_at DESC`).all()
    : request.user.role === 'student'
      ? db.prepare(`SELECT q.*, c.title AS courseTitle FROM student_questions q JOIN courses c ON c.id = q.course_id WHERE q.student_email = ? ORDER BY q.updated_at DESC`).all(request.user.email)
      : db.prepare(`SELECT q.*, c.title AS courseTitle FROM student_questions q JOIN courses c ON c.id = q.course_id
        WHERE q.teacher_email = ? ORDER BY q.updated_at DESC`).all(request.user.email)
  response.json({ questions: rows.map((row) => {
    const question = { id: row.id, courseId: row.course_id, courseTitle: row.courseTitle, studentEmail: row.student_email, teacherEmail: row.teacher_email, subject: row.subject, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
    return { ...question, messages: canAccessQuestion(request, question) ? db.prepare(`SELECT m.id, m.sender_email AS senderEmail, u.name AS senderName, m.body, m.created_at AS createdAt
      FROM question_messages m JOIN users u ON u.email = m.sender_email WHERE m.question_id = ? ORDER BY m.created_at`).all(row.id) : [] }
  }) })
})

app.post('/api/student/courses/:courseId/questions', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  if (!hasApprovedCoursePurchase(request.user.email, courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const teacherEmail = String(request.body?.teacherEmail || '').trim().toLowerCase()
  const subject = String(request.body?.subject || '').trim()
  const body = String(request.body?.body || '').trim()
  if (!subject || subject.length > 180 || !body || body.length > 5000) return next(HttpError(400, 'Provide a subject and question under 5,000 characters.'))
  if (!getTeacherPermissions(teacherEmail).manageMessages || !hasTeacherCourseAssignment(teacherEmail, courseId)) return next(HttpError(400, 'Choose a teacher assigned to this course who accepts student questions.'))
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const create = db.transaction(() => {
    db.prepare(`INSERT INTO student_questions (id, course_id, student_email, teacher_email, subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, courseId, request.user.email, teacherEmail, subject, now, now)
    db.prepare('INSERT INTO question_messages (id, question_id, sender_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), id, request.user.email, body, now)
    db.prepare('INSERT INTO notifications (id, recipient_email, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), teacherEmail, 'New student question', subject, now)
  })
  create()
  response.status(201).json({ id, courseId, teacherEmail, subject, status: 'open', createdAt: now })
})

app.post('/api/questions/:id/messages', requireSession, (request, response, next) => {
  const row = db.prepare('SELECT * FROM student_questions WHERE id = ?').get(request.params.id)
  if (!row) return next(HttpError(404, 'Question was not found.'))
  const question = { courseId: row.course_id, studentEmail: row.student_email, teacherEmail: row.teacher_email }
  if (!canAccessQuestion(request, question)) return next(HttpError(403, 'This is not your student-teacher conversation.'))
  if (row.status !== 'open') return next(HttpError(409, 'This question is closed.'))
  const body = String(request.body?.body || '').trim()
  if (!body || body.length > 5000) return next(HttpError(400, 'Provide a message under 5,000 characters.'))
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO question_messages (id, question_id, sender_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), row.id, request.user.email, body, createdAt)
  db.prepare('UPDATE student_questions SET updated_at = ? WHERE id = ?').run(createdAt, row.id)
  const recipient = request.user.email === row.student_email ? row.teacher_email : row.student_email
  db.prepare('INSERT INTO notifications (id, recipient_email, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), recipient, 'New course question reply', body.slice(0, 180), createdAt)
  response.status(201).json({ senderEmail: request.user.email, body, createdAt })
})

app.patch('/api/questions/:id/status', requireSession, (request, response, next) => {
  const row = db.prepare('SELECT * FROM student_questions WHERE id = ?').get(request.params.id)
  if (!row) return next(HttpError(404, 'Question was not found.'))
  if (!canAccessQuestion(request, { courseId: row.course_id, studentEmail: row.student_email, teacherEmail: row.teacher_email })) return next(HttpError(403, 'This is not your conversation.'))
  if (!['open', 'closed'].includes(request.body?.status)) return next(HttpError(400, 'Status must be open or closed.'))
  db.prepare('UPDATE student_questions SET status = ?, updated_at = ? WHERE id = ?').run(request.body.status, new Date().toISOString(), row.id)
  response.json({ id: row.id, status: request.body.status })
})

app.get('/api/student/certificates', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const courses = listCourses('student', request.user.email).filter((course) => course.purchased)
  const certificates = courses.map((course) => {
    const lessonCount = db.prepare("SELECT COUNT(*) AS count FROM content WHERE course_id = ? AND kind = 'lecture'").get(course.id).count
    const completeCount = db.prepare(`SELECT COUNT(*) AS count FROM lesson_progress lp JOIN content c ON c.id = lp.content_id
      WHERE lp.course_id = ? AND lp.student_email = ? AND lp.completed = 1`).get(course.id, request.user.email).count
    const missedAssessments = db.prepare(`SELECT COUNT(*) AS count FROM assessments a WHERE a.course_id = ? AND a.published = 1
      AND NOT EXISTS (SELECT 1 FROM assessment_attempts aa WHERE aa.assessment_id = a.id AND aa.student_email = ? AND aa.submitted_at != '')`)
      .get(course.id, request.user.email).count
    const eligible = lessonCount > 0 && completeCount === lessonCount && missedAssessments === 0
    const certificate = db.prepare(`SELECT id, verification_code AS verificationCode, issued_at AS issuedAt FROM certificates
      WHERE student_email = ? AND course_id = ?`).get(request.user.email, course.id)
    return { courseId: course.id, courseTitle: course.title, lessonCount, completeCount, missedAssessments, eligible, certificate: certificate || null }
  })
  response.json({ certificates })
})

app.post('/api/student/courses/:courseId/certificate', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const { courseId } = request.params
  if (!hasApprovedCoursePurchase(request.user.email, courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const lessonCount = db.prepare("SELECT COUNT(*) AS count FROM content WHERE course_id = ? AND kind = 'lecture'").get(courseId).count
  const completeCount = db.prepare(`SELECT COUNT(*) AS count FROM lesson_progress lp JOIN content c ON c.id = lp.content_id
    WHERE lp.course_id = ? AND lp.student_email = ? AND lp.completed = 1`).get(courseId, request.user.email).count
  const missedAssessments = db.prepare(`SELECT COUNT(*) AS count FROM assessments a WHERE a.course_id = ? AND a.published = 1
    AND NOT EXISTS (SELECT 1 FROM assessment_attempts aa WHERE aa.assessment_id = a.id AND aa.student_email = ? AND aa.submitted_at != '')`)
    .get(courseId, request.user.email).count
  if (!lessonCount || lessonCount !== completeCount || missedAssessments) return next(HttpError(409, 'Complete all course lessons and published assessments before requesting a certificate.'))
  let certificate = db.prepare(`SELECT id, verification_code AS verificationCode, issued_at AS issuedAt FROM certificates
    WHERE student_email = ? AND course_id = ?`).get(request.user.email, courseId)
  if (!certificate) {
    const id = crypto.randomUUID()
    const verificationCode = crypto.randomBytes(9).toString('hex').toUpperCase()
    const issuedAt = new Date().toISOString()
    db.prepare('INSERT INTO certificates (id, verification_code, student_email, course_id, issued_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, verificationCode, request.user.email, courseId, issuedAt)
    certificate = { id, verificationCode, issuedAt }
  }
  response.status(201).json({ certificate })
})

app.get('/api/certificates/:code', (request, response, next) => {
  const certificate = db.prepare(`SELECT ce.verification_code AS verificationCode, ce.issued_at AS issuedAt,
      u.name AS studentName, c.title AS courseTitle FROM certificates ce
      JOIN users u ON u.email = ce.student_email JOIN courses c ON c.id = ce.course_id
      WHERE ce.verification_code = ?`).get(String(request.params.code || '').toUpperCase())
  if (!certificate) return next(HttpError(404, 'Certificate verification code was not found.'))
  response.json({ certificate })
})

app.get('/api/certificates/:code/print', (request, response, next) => {
  const certificate = db.prepare(`SELECT ce.verification_code AS verificationCode, ce.issued_at AS issuedAt,
      u.name AS studentName, c.title AS courseTitle FROM certificates ce
      JOIN users u ON u.email = ce.student_email JOIN courses c ON c.id = ce.course_id
      WHERE ce.verification_code = ?`).get(String(request.params.code || '').toUpperCase())
  if (!certificate) return next(HttpError(404, 'Certificate verification code was not found.'))
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
  const issuedDate = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(certificate.issuedAt))
  response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paragon Academy course certificate</title><style>
    *{box-sizing:border-box}body{margin:0;padding:32px;background:#f2f5f1;color:#34473a;font-family:Georgia,serif}.certificate{position:relative;display:grid;align-content:center;justify-items:center;gap:22px;max-width:1000px;min-height:680px;margin:auto;padding:64px;border:8px double #7b9a7d;background:#fff;text-align:center}.brand{font:700 16px Arial,sans-serif;letter-spacing:4px;color:#66836a}.eyebrow{font:700 12px Arial,sans-serif;letter-spacing:3px;color:#829086}.heading{margin:0;font:italic 50px Georgia,serif;color:#34473a}.name{margin:0;font:40px Georgia,serif;color:#58785c}.course{max-width:700px;margin:0;font:700 27px Georgia,serif}.detail{margin:0;font:15px Arial,sans-serif;color:#78867d}.verification{margin-top:14px;padding-top:16px;border-top:1px solid #dfe7df;font:12px Arial,sans-serif;color:#78867d}.verify-link{font:12px Arial,sans-serif;color:#527a59}.print-hint{font:12px Arial,sans-serif;color:#78867d}@media print{body{padding:0;background:#fff}.certificate{max-width:none;min-height:96vh;border-color:#7b9a7d}.print-hint{display:none}}
    </style></head><body><main class="certificate"><div class="brand">PARAGON ACADEMY</div><p class="eyebrow">COURSE COMPLETION</p><h1 class="heading">Certificate of Achievement</h1><p class="detail">This certifies that</p><p class="name">${escapeHtml(certificate.studentName)}</p><p class="detail">has successfully completed</p><p class="course">${escapeHtml(certificate.courseTitle)}</p><p class="detail">Issued ${escapeHtml(issuedDate)}</p><div class="verification">Verification code: <strong>${escapeHtml(certificate.verificationCode)}</strong><br><a class="verify-link" href="/api/certificates/${encodeURIComponent(certificate.verificationCode)}">Verify certificate</a></div></main><p class="print-hint">Use your browser's Print command to print or save this certificate as PDF.</p></body></html>`)
})

app.patch('/api/student/leaderboard-preference', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  if (typeof request.body?.enabled !== 'boolean') return next(HttpError(400, 'Enabled must be true or false.'))
  db.prepare('UPDATE users SET leaderboard_opt_in = ? WHERE email = ?').run(Number(request.body.enabled), request.user.email)
  response.json({ enabled: request.body.enabled })
})

app.get('/api/student/courses/:courseId/leaderboard', requireSession, (request, response, next) => {
  const { courseId } = request.params
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  if (!hasApprovedCoursePurchase(request.user.email, courseId)) return next(HttpError(402, 'An active course subscription is required.'))
  const optedIn = Boolean(db.prepare('SELECT leaderboard_opt_in FROM users WHERE email = ?').get(request.user.email)?.leaderboard_opt_in)
  const eligible = db.prepare(`SELECT DISTINCT u.email, u.name FROM users u JOIN subscriptions s ON s.student_email = u.email
    WHERE u.role = 'student' AND u.active = 1 AND u.leaderboard_opt_in = 1 AND s.course_id = ? AND s.status = 'active' AND s.expires_at > ?
    UNION SELECT DISTINCT u.email, u.name FROM users u JOIN purchases p ON p.student_email = u.email
    WHERE u.role = 'student' AND u.active = 1 AND u.leaderboard_opt_in = 1 AND p.course_id = ? AND p.status = 'paid'
    UNION SELECT DISTINCT u.email, u.name FROM users u JOIN courses c ON c.id = ? AND c.published = 1 AND c.price_pkr = 0
    WHERE u.role = 'student' AND u.active = 1 AND u.leaderboard_opt_in = 1`)
    .all(courseId, new Date().toISOString(), courseId, courseId)
  const totalLessons = db.prepare("SELECT COUNT(*) AS count FROM content WHERE course_id = ? AND kind = 'lecture'").get(courseId).count
  const hasAssessments = db.prepare('SELECT 1 FROM assessments WHERE course_id = ? AND published = 1 LIMIT 1').get(courseId)
  const board = eligible.map((student) => {
    const completed = db.prepare(`SELECT COUNT(*) AS count FROM lesson_progress lp JOIN content c ON c.id = lp.content_id
      WHERE lp.student_email = ? AND c.course_id = ? AND lp.completed = 1`).get(student.email, courseId).count
    const average = db.prepare(`SELECT COALESCE(AVG(percentage), 0) AS score FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
      WHERE aa.student_email = ? AND a.course_id = ? AND aa.submitted_at != ''`).get(student.email, courseId).score
    const progressScore = totalLessons ? completed / totalLessons * 100 : 0
    const score = Math.round(hasAssessments ? progressScore * 0.5 + average * 0.5 : progressScore)
    return { name: student.name.trim().split(/\s+/)[0], score, self: student.email === request.user.email }
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map((entry, index) => ({ rank: index + 1, ...entry }))
  response.json({ optedIn, leaderboard: board })
})

app.get('/api/feedback', requireSession, (request, response, next) => {
  let query
  let params = []
  if (request.user.role === 'admin') {
    query = `SELECT f.id, f.student_email AS studentEmail, u.name AS studentName, f.course_id AS courseId,
        c.title AS courseTitle, f.content_id AS contentId, co.title AS contentTitle,
        f.teacher_email AS teacherEmail, f.rating, f.comment, f.created_at AS createdAt
      FROM feedback f JOIN users u ON u.email = f.student_email
      JOIN courses c ON c.id = f.course_id LEFT JOIN content co ON co.id = f.content_id ORDER BY f.created_at DESC`
  } else if (request.user.role === 'teacher' && getTeacherPermissions(request.user.email).manageFeedback) {
    query = `SELECT f.id, f.student_email AS studentEmail, u.name AS studentName, f.course_id AS courseId,
        c.title AS courseTitle, f.content_id AS contentId, co.title AS contentTitle,
        f.teacher_email AS teacherEmail, f.rating, f.comment, f.created_at AS createdAt
      FROM feedback f JOIN users u ON u.email = f.student_email
      JOIN courses c ON c.id = f.course_id LEFT JOIN content co ON co.id = f.content_id
      WHERE EXISTS (SELECT 1 FROM teacher_course_assignments a WHERE a.teacher_email = ? AND a.course_id = f.course_id)
      ORDER BY f.created_at DESC`
    params = [request.user.email]
  } else if (request.user.role === 'student') {
    query = `SELECT f.id, f.course_id AS courseId, c.title AS courseTitle, f.content_id AS contentId,
        co.title AS contentTitle, f.teacher_email AS teacherEmail, f.rating, f.comment, f.created_at AS createdAt
      FROM feedback f JOIN courses c ON c.id = f.course_id LEFT JOIN content co ON co.id = f.content_id
      WHERE f.student_email = ? ORDER BY f.created_at DESC`
    params = [request.user.email]
  } else return next(HttpError(403, 'Feedback access is not permitted.'))
  const feedback = db.prepare(query).all(...params).map((item) => ({
    ...item,
    responses: db.prepare(`SELECT id, teacher_email AS teacherEmail, body, created_at AS createdAt
      FROM feedback_responses WHERE feedback_id = ? ORDER BY created_at`).all(item.id),
  }))
  response.json({ feedback })
})

app.post('/api/feedback/:id/replies', requireSession, (request, response, next) => {
  if (!['admin', 'teacher'].includes(request.user.role)) return next(HttpError(403, 'Only the owner or an authorized teacher can respond to feedback.'))
  const feedback = db.prepare('SELECT id, student_email AS studentEmail, course_id AS courseId FROM feedback WHERE id = ?').get(request.params.id)
  if (!feedback) return next(HttpError(404, 'Feedback was not found.'))
  if (request.user.role === 'teacher' && (
    !getTeacherPermissions(request.user.email).manageFeedback
    || !hasTeacherCourseAssignment(request.user.email, feedback.courseId)
  )) return next(HttpError(403, 'You do not have permission to respond to feedback for this course.'))
  const body = String(request.body?.body || '').trim()
  if (!body || body.length > 2000) return next(HttpError(400, 'Provide a response of up to 2000 characters.'))
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(`INSERT INTO feedback_responses (id, feedback_id, teacher_email, body, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(id, feedback.id, request.user.email, body, createdAt)
  db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, 'A response to your course feedback', ?, ?)`)
    .run(crypto.randomUUID(), feedback.studentEmail, body, createdAt)
  response.status(201).json({ response: { id, feedbackId: feedback.id, teacherEmail: request.user.email, body, createdAt } })
})

app.get('/api/admin/progress', requireSession, requireAdmin, (_request, response) => {
  const rows = db.prepare(`SELECT u.email, u.name, c.id AS courseId, c.title AS courseTitle,
      (SELECT COUNT(*) FROM content co WHERE co.course_id = c.id AND co.kind = 'lecture') AS totalLessons,
      (SELECT COUNT(*) FROM lesson_progress lp JOIN content co ON co.id = lp.content_id
        WHERE lp.student_email = u.email AND co.course_id = c.id AND lp.completed = 1) AS completedLessons,
      (SELECT COUNT(*) FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
        WHERE aa.student_email = u.email AND a.course_id = c.id AND aa.submitted_at != '') AS attempts
    FROM users u CROSS JOIN courses c WHERE u.role = 'student' AND u.active = 1
      AND (EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_email = u.email AND s.course_id = c.id AND s.status = 'active' AND s.expires_at > ?)
        OR EXISTS (SELECT 1 FROM purchases p WHERE p.student_email = u.email AND p.course_id = c.id AND p.status = 'paid'))
    ORDER BY c.title, u.name`).all(new Date().toISOString())
  response.json({ progress: rows.map((row) => ({ ...row, percentage: row.totalLessons ? Math.round(row.completedLessons / row.totalLessons * 100) : 0 })) })
})

app.get('/api/teacher/courses/:courseId/students', requireSession, requireTeacherPermission('manageStudents'), (request, response) => {
  const students = db.prepare(`SELECT u.email, u.name, u.phone,
      s.expires_at AS expiresAt, s.status AS subscriptionStatus,
      (SELECT COUNT(*) FROM lesson_progress lp JOIN content c ON c.id = lp.content_id
        WHERE lp.student_email = u.email AND c.course_id = ? AND lp.completed = 1) AS completedLessons
    FROM subscriptions s JOIN users u ON u.email = s.student_email
    WHERE s.course_id = ? AND s.status = 'active' AND s.expires_at > ? AND u.active = 1
    ORDER BY u.name`).all(request.params.courseId, request.params.courseId, new Date().toISOString())
  response.json({ students })
})

app.get('/api/teacher/courses/:courseId/payments', requireSession, requireTeacherPermission('managePayments'), (request, response, next) => {
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(request.params.courseId)) return next(HttpError(404, 'Course was not found.'))
  const payments = db.prepare(`SELECT po.id, po.student_email AS studentEmail, u.name AS studentName,
      po.amount_pkr AS amountPkr, po.status, po.transfer_reference AS transferReference,
      po.created_at AS createdAt, po.reviewed_at AS reviewedAt
    FROM payment_orders po JOIN users u ON u.email = po.student_email
    WHERE po.course_id = ? ORDER BY po.created_at DESC`).all(request.params.courseId)
  response.json({ payments })
})

app.get('/api/student/subscriptions', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const subscriptions = db.prepare(`SELECT s.course_id AS courseId, c.title AS courseTitle,
      s.status, s.starts_at AS startsAt, s.expires_at AS expiresAt, s.amount_pkr AS amountPkr
    FROM subscriptions s JOIN courses c ON c.id = s.course_id
    WHERE s.student_email = ? ORDER BY s.updated_at DESC`).all(request.user.email)
    .map((subscription) => ({
      ...subscription,
      status: subscription.status === 'active' && subscription.expiresAt <= new Date().toISOString() ? 'expired' : subscription.status,
    }))
  response.json({ subscriptions })
})

app.get('/api/admin/subscriptions', requireSession, requireAdmin, (_request, response) => {
  const subscriptions = db.prepare(`SELECT s.student_email AS studentEmail, u.name AS studentName,
      s.course_id AS courseId, c.title AS courseTitle, s.status, s.starts_at AS startsAt,
      s.expires_at AS expiresAt, s.amount_pkr AS amountPkr, s.updated_at AS updatedAt
    FROM subscriptions s JOIN users u ON u.email = s.student_email JOIN courses c ON c.id = s.course_id
    ORDER BY s.updated_at DESC`).all().map((subscription) => ({
    ...subscription,
    status: subscription.expiresAt <= new Date().toISOString() && subscription.status === 'active' ? 'expired' : subscription.status,
  }))
  response.json({ subscriptions })
})

app.patch('/api/admin/subscriptions/:studentEmail/:courseId', requireSession, requireAdmin, (request, response, next) => {
  const email = String(request.params.studentEmail || '').toLowerCase()
  const action = request.body?.action
  if (!['renew', 'cancel'].includes(action)) return next(HttpError(400, 'Action must be renew or cancel.'))
  const course = db.prepare('SELECT id, price_pkr FROM courses WHERE id = ?').get(request.params.courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  const existing = db.prepare('SELECT 1 FROM subscriptions WHERE student_email = ? AND course_id = ?').get(email, course.id)
  if (!existing) return next(HttpError(404, 'Subscription was not found.'))
  if (action === 'cancel') {
    db.prepare(`UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE student_email = ? AND course_id = ?`)
      .run(new Date().toISOString(), email, course.id)
  } else {
    activateCourseSubscription(email, course.id, course.price_pkr)
  }
  const courseTitle = db.prepare('SELECT title FROM courses WHERE id = ?').get(course.id).title
  db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    email,
    action === 'renew' ? 'Course subscription renewed' : 'Course subscription cancelled',
    action === 'renew'
      ? `Your subscription to ${courseTitle} has been renewed.`
      : `Your subscription to ${courseTitle} was cancelled and course access has ended.`,
    new Date().toISOString(),
  )
  response.json({ studentEmail: email, courseId: course.id, action })
})

app.get('/api/admin/analytics', requireSession, requireAdmin, (_request, response) => {
  const result = {
    students: db.prepare("SELECT COUNT(*) AS value FROM users WHERE role = 'student'").get().value,
    activeStudents: db.prepare("SELECT COUNT(*) AS value FROM users WHERE role = 'student' AND active = 1").get().value,
    teachers: db.prepare("SELECT COUNT(*) AS value FROM users WHERE role = 'teacher'").get().value,
    courses: db.prepare('SELECT COUNT(*) AS value FROM courses').get().value,
    publishedCourses: db.prepare('SELECT COUNT(*) AS value FROM courses WHERE published = 1').get().value,
    activeSubscriptions: db.prepare("SELECT COUNT(*) AS value FROM subscriptions WHERE status = 'active' AND expires_at > ?").get(new Date().toISOString()).value,
    pendingPayments: db.prepare("SELECT COUNT(*) AS value FROM payment_orders WHERE status = 'pending'").get().value,
    approvedRevenuePkr: db.prepare("SELECT COALESCE(SUM(amount_pkr), 0) AS value FROM payment_orders WHERE status = 'approved'").get().value,
    assessmentAttempts: db.prepare("SELECT COUNT(*) AS value FROM assessment_attempts WHERE submitted_at != ''").get().value,
    averageAssessmentScore: db.prepare("SELECT COALESCE(AVG(percentage), 0) AS value FROM assessment_attempts WHERE submitted_at != ''").get().value,
    feedbackCount: db.prepare('SELECT COUNT(*) AS value FROM feedback').get().value,
    averageFeedbackRating: db.prepare('SELECT COALESCE(AVG(rating), 0) AS value FROM feedback').get().value,
  }
  response.json({ analytics: { ...result, averageAssessmentScore: Math.round(result.averageAssessmentScore), averageFeedbackRating: Number(result.averageFeedbackRating.toFixed(1)) } })
})

app.get('/api/admin/teacher-performance', requireSession, requireAdmin, (_request, response) => {
  const pairs = db.prepare(`SELECT DISTINCT u.email AS teacherEmail, u.name AS teacherName, c.id AS courseId, c.title AS courseTitle
    FROM teacher_course_assignments a JOIN users u ON u.email = a.teacher_email
    JOIN courses c ON c.id = a.course_id ORDER BY u.name, c.title`).all()
  const performance = pairs.map((row) => {
    const learners = db.prepare(`SELECT DISTINCT u.email FROM users u WHERE u.role = 'student' AND u.active = 1 AND
      (EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_email = u.email AND s.course_id = ? AND s.status = 'active' AND s.expires_at > ?)
       OR EXISTS (SELECT 1 FROM purchases p WHERE p.student_email = u.email AND p.course_id = ? AND p.status = 'paid')
       OR EXISTS (SELECT 1 FROM courses c WHERE c.id = ? AND c.published = 1 AND c.price_pkr = 0))`)
      .all(row.courseId, new Date().toISOString(), row.courseId, row.courseId)
    const completed = db.prepare(`SELECT COUNT(*) AS value FROM lesson_progress lp JOIN content c ON c.id = lp.content_id
      WHERE c.course_id = ? AND lp.completed = 1 AND lp.student_email IN (
        SELECT u.email FROM users u WHERE u.role = 'student' AND u.active = 1 AND
        (EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_email = u.email AND s.course_id = ? AND s.status = 'active' AND s.expires_at > ?)
         OR EXISTS (SELECT 1 FROM purchases p WHERE p.student_email = u.email AND p.course_id = ? AND p.status = 'paid')
         OR EXISTS (SELECT 1 FROM courses free_course WHERE free_course.id = ? AND free_course.published = 1 AND free_course.price_pkr = 0)))`)
      .get(row.courseId, row.courseId, new Date().toISOString(), row.courseId, row.courseId).value
    const totalLessons = db.prepare("SELECT COUNT(*) AS value FROM content WHERE course_id = ? AND kind = 'lecture'").get(row.courseId).value
    const assessment = db.prepare(`SELECT COUNT(*) AS attempts, COALESCE(AVG(percentage), 0) AS average FROM assessment_attempts aa
      JOIN assessments a ON a.id = aa.assessment_id WHERE a.course_id = ? AND aa.submitted_at != ''`).get(row.courseId)
    const attendance = db.prepare(`SELECT COUNT(*) AS marked, COALESCE(SUM(attended), 0) AS attended FROM live_class_attendance la
      JOIN live_classes lc ON lc.id = la.live_class_id WHERE lc.course_id = ?`).get(row.courseId)
    const feedback = db.prepare('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM feedback WHERE course_id = ? AND teacher_email = ?')
      .get(row.courseId, row.teacherEmail)
    const submissions = db.prepare(`SELECT COUNT(*) AS count, SUM(CASE WHEN s.grade IS NOT NULL THEN 1 ELSE 0 END) AS reviewed
      FROM assignment_submissions s JOIN course_assignments a ON a.id = s.assignment_id
      WHERE a.course_id = ? AND a.created_by = ?`).get(row.courseId, row.teacherEmail)
    return {
      ...row,
      activeStudents: learners.length,
      lessonCompletionRate: totalLessons && learners.length ? Math.round(completed / (totalLessons * learners.length) * 100) : 0,
      assessmentAttempts: assessment.attempts,
      averageAssessmentScore: Math.round(assessment.average),
      attendanceRate: attendance.marked ? Math.round(attendance.attended / attendance.marked * 100) : null,
      attendanceMarked: attendance.marked,
      feedbackCount: feedback.count,
      averageFeedbackRating: Number(feedback.average.toFixed(1)),
      assignmentSubmissions: submissions.count,
      assignmentsReviewed: submissions.reviewed || 0,
    }
  })
  response.json({ performance })
})

app.get('/api/admin/coupons', requireSession, requireAdmin, (_request, response) => {
  const coupons = db.prepare(`SELECT cp.id, cp.code, cp.discount_type AS discountType, cp.discount_value AS discountValue,
    cp.max_uses AS maxUses, cp.uses, cp.expires_at AS expiresAt, cp.course_id AS courseId, c.title AS courseTitle,
    cp.active, cp.created_at AS createdAt FROM coupons cp LEFT JOIN courses c ON c.id = cp.course_id ORDER BY cp.created_at DESC`).all()
  response.json({ coupons: coupons.map((coupon) => ({ ...coupon, active: Boolean(coupon.active) })) })
})

app.post('/api/admin/coupons', requireSession, requireAdmin, (request, response, next) => {
  const code = String(request.body?.code || '').trim().toUpperCase()
  const discountType = request.body?.discountType
  const discountValue = Number(request.body?.discountValue)
  const maxUses = request.body?.maxUses === '' || request.body?.maxUses === null || request.body?.maxUses === undefined
    ? null : Number(request.body.maxUses)
  const courseId = request.body?.courseId ? String(request.body.courseId) : null
  const expiresAtValue = request.body?.expiresAt ? String(request.body.expiresAt) : ''
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null
  if (!/^[A-Z0-9_-]{3,40}$/.test(code) || !['percent', 'fixed'].includes(discountType)
    || !Number.isSafeInteger(discountValue) || discountValue < 1
    || (discountType === 'percent' && discountValue > 100)
    || (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1))
    || (expiresAtValue && !Number.isFinite(expiresAt.getTime()))
    || (courseId && !db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId))) {
    return next(HttpError(400, 'Provide a valid coupon code, discount, optional redemption limit, expiry and course scope.'))
  }
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ? COLLATE NOCASE').get(code)) return next(HttpError(409, 'A coupon with this code already exists.'))
  const id = crypto.randomUUID()
  try {
    db.prepare(`INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, expires_at, course_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, code, discountType, discountValue, maxUses, expiresAt?.toISOString() || null, courseId, new Date().toISOString())
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(HttpError(409, 'A coupon with this code already exists.'))
    return next(error)
  }
  response.status(201).json({ id, code, discountType, discountValue, maxUses, uses: 0, expiresAt: expiresAt?.toISOString() || null, courseId, active: true })
})

app.patch('/api/admin/coupons/:id', requireSession, requireAdmin, (request, response, next) => {
  if (typeof request.body?.active !== 'boolean') return next(HttpError(400, 'Active must be true or false.'))
  const result = db.prepare('UPDATE coupons SET active = ? WHERE id = ?').run(Number(request.body.active), request.params.id)
  if (!result.changes) return next(HttpError(404, 'Coupon was not found.'))
  response.json({ id: request.params.id, active: request.body.active })
})

app.get('/api/admin/settings', requireSession, requireAdmin, (_request, response) => {
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM site_settings').all().map((row) => [row.key, row.value]))
  try {
    settings.paymentMethods = JSON.parse(settings.paymentMethods || '[]')
  } catch (error) {
    console.error('Stored payment method settings are invalid JSON.', error)
    return response.status(500).json({ error: 'Payment methods could not be loaded because their settings are invalid.' })
  }
  response.json({ settings })
})

app.patch('/api/admin/settings', requireSession, requireAdmin, (request, response, next) => {
  const allowed = ['platformName', 'supportEmail', 'defaultSubscriptionDays', 'paymentMethods']
  const values = request.body?.settings
  if (!values || typeof values !== 'object' || Array.isArray(values)) return next(HttpError(400, 'Provide a settings object.'))
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key)) return next(HttpError(400, `Invalid setting: ${key}.`))
    if (key === 'paymentMethods') {
      if (!Array.isArray(value) || value.length > 12) return next(HttpError(400, 'Provide no more than 12 payment methods.'))
      const ids = new Set()
      for (const method of value) {
        if (!method || typeof method !== 'object' || typeof method.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(method.id)
          || ids.has(method.id) || typeof method.name !== 'string' || !method.name.trim() || method.name.length > 80
          || typeof method.instructions !== 'string' || method.instructions.length > 1000 || typeof method.enabled !== 'boolean') {
          return next(HttpError(400, 'Each payment method needs a unique id, name, instructions, and enabled status.'))
        }
        ids.add(method.id)
      }
      continue
    }
    if (typeof value !== 'string' || value.length > 160) return next(HttpError(400, `Invalid setting: ${key}.`))
    if (key === 'defaultSubscriptionDays' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 3650)) {
      return next(HttpError(400, 'Default subscription duration must be between 1 and 3650 days.'))
    }
  }
  const save = db.transaction(() => {
    const update = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    for (const [key, value] of Object.entries(values)) update.run(key, key === 'paymentMethods' ? JSON.stringify(value) : value)
  })
  save()
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM site_settings').all().map((row) => [row.key, row.value]))
  settings.paymentMethods = JSON.parse(settings.paymentMethods || '[]')
  response.json({ settings })
})

app.get('/api/payment-methods', requireSession, (request, response, next) => {
  const stored = db.prepare("SELECT value FROM site_settings WHERE key = 'paymentMethods'").get()?.value || '[]'
  try {
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) throw new Error('Payment methods must be stored as an array.')
    const methods = parsed.filter((method) => method.enabled)
    response.json({ methods })
  } catch (error) {
    console.error('Stored payment method settings are invalid.', error)
    next(HttpError(500, 'Payment methods could not be loaded.'))
  }
})

app.get('/api/teacher/courses/:courseId/progress', requireSession, requireTeacherPermission('viewStudentProgress'), (request, response) => {
  const rows = db.prepare(`SELECT u.email, u.name,
      (SELECT COUNT(*) FROM content co WHERE co.course_id = ? AND co.kind = 'lecture') AS totalLessons,
      (SELECT COUNT(*) FROM lesson_progress lp JOIN content co ON co.id = lp.content_id
        WHERE lp.student_email = u.email AND co.course_id = ? AND lp.completed = 1) AS completedLessons,
      (SELECT COUNT(*) FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
        WHERE aa.student_email = u.email AND a.course_id = ? AND aa.submitted_at != '') AS attempts
    FROM users u WHERE u.role = 'student' AND u.active = 1
      AND (EXISTS (SELECT 1 FROM purchases p WHERE p.student_email = u.email AND p.course_id = ? AND p.status = 'paid')
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_email = u.email AND s.course_id = ? AND s.status = 'active' AND s.expires_at > ?))
    ORDER BY u.name`).all(request.params.courseId, request.params.courseId, request.params.courseId,
    request.params.courseId, request.params.courseId, new Date().toISOString())
  response.json({ progress: rows.map((row) => ({ ...row, percentage: row.totalLessons ? Math.round(row.completedLessons / row.totalLessons * 100) : 0 })) })
})

app.post('/api/admin/courses', requireSession, requireAdmin, (request, response, next) => {
  const title = String(request.body?.title || '').trim()
  const description = String(request.body?.description || '').trim()
  const category = String(request.body?.category || 'Other').trim().slice(0, 60)
  const subject = String(request.body?.subject || '').trim().slice(0, 100)
  const classLevel = String(request.body?.classLevel || '').trim().slice(0, 100)
  const price = Number(request.body?.price || 0)
  const configuredDefaultDays = Number(db.prepare("SELECT value FROM site_settings WHERE key = 'defaultSubscriptionDays'").get()?.value || 365)
  const subscriptionDays = Number(request.body?.subscriptionDays ?? configuredDefaultDays)
  if (!title || title.length > 180 || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(subscriptionDays) || subscriptionDays < 1 || subscriptionDays > 3650) {
    return next(HttpError(400, 'Provide a title and a valid PKR course price.'))
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(`INSERT INTO courses (id, title, description, category, subject, class_level, instructor, price_pkr, subscription_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, title, description, category, subject, classLevel, request.user.email, price, subscriptionDays, createdAt)
  response.status(201).json({ course: { id, title, description, category, subject, classLevel, instructor: request.user.email, price, subscriptionDays, published: false, createdAt, chapters: [] } })
})

app.post('/api/admin/courses/:courseId/chapters', requireSession, requireAdmin, (request, response, next) => {
  const { courseId } = request.params
  const title = String(request.body?.title || '').trim()
  const description = String(request.body?.description || '').trim()
  const topic = String(request.body?.topic || '').trim().slice(0, 100)
  if (!safeId(courseId) || !title || title.length > 180) return next(HttpError(400, 'Provide a valid course and chapter title.'))
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return next(HttpError(404, 'Course was not found.'))
  const id = crypto.randomUUID()
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM chapters WHERE course_id = ?').get(courseId).next
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO chapters (id, course_id, title, description, topic, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, courseId, title, description, topic, position, createdAt)
  response.status(201).json({ chapter: { id, courseId, title, description, topic, lectures: [], materials: [], createdAt } })
})

app.patch('/api/admin/courses/:courseId', requireSession, requireAdmin, (request, response, next) => {
  const { courseId } = request.params
  const title = String(request.body?.title || '').trim()
  const description = String(request.body?.description || '').trim()
  const category = String(request.body?.category || 'Other').trim().slice(0, 60)
  const subject = String(request.body?.subject || '').trim().slice(0, 100)
  const classLevel = String(request.body?.classLevel || '').trim().slice(0, 100)
  const price = Number(request.body?.price)
  const subscriptionDays = Number(request.body?.subscriptionDays)
  if (!safeId(courseId) || !title || title.length > 180 || description.length > 5000
    || !Number.isSafeInteger(price) || price < 0
    || !Number.isInteger(subscriptionDays) || subscriptionDays < 1 || subscriptionDays > 3650) {
    return next(HttpError(400, 'Provide a valid title, description, PKR price, and subscription duration.'))
  }
  const result = db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, subject = ?, class_level = ?, price_pkr = ?, subscription_days = ?
    WHERE id = ?`).run(title, description, category, subject, classLevel, price, subscriptionDays, courseId)
  if (!result.changes) return next(HttpError(404, 'Course was not found.'))
  response.json({ course: { id: courseId, title, description, category, subject, classLevel, price, subscriptionDays } })
})

app.patch('/api/admin/courses/:courseId/publish', requireSession, requireAdmin, (request, response, next) => {
  const { courseId } = request.params
  const course = db.prepare('SELECT published FROM courses WHERE id = ?').get(courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  if (Boolean(request.body?.published) && db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE course_id = ?').get(courseId).count === 0) {
    return next(HttpError(409, 'Add at least one chapter before publishing.'))
  }
  const wasPublished = Boolean(course.published)
  const published = request.body?.published ? 1 : 0
  db.prepare('UPDATE courses SET published = ? WHERE id = ?').run(published, courseId)
  if (published && !wasPublished) notifyCourseStudents(null, 'New course available', 'A new course is now available in the course catalog.')
  response.json({ courseId, published: Boolean(published) })
})

app.delete('/api/admin/courses/:courseId', requireSession, requireAdmin, async (request, response, next) => {
  try {
    const { courseId } = request.params
    if (!safeId(courseId)) throw HttpError(400, 'Invalid course id.')
    const items = db.prepare('SELECT storage_key FROM content WHERE course_id = ?').all(courseId)
    const remove = db.transaction(() => {
      db.prepare(`DELETE FROM assessment_attempt_questions WHERE attempt_id IN (
        SELECT aa.id FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id WHERE a.course_id = ?
      )`).run(courseId)
      db.prepare(`DELETE FROM assessment_attempts WHERE assessment_id IN (SELECT id FROM assessments WHERE course_id = ?)`).run(courseId)
      db.prepare(`DELETE FROM assessment_questions WHERE assessment_id IN (SELECT id FROM assessments WHERE course_id = ?)`).run(courseId)
      db.prepare('DELETE FROM assessments WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM lesson_progress WHERE course_id = ?').run(courseId)
      db.prepare(`DELETE FROM live_class_attendance WHERE live_class_id IN (SELECT id FROM live_classes WHERE course_id = ?)`).run(courseId)
      db.prepare('DELETE FROM live_classes WHERE course_id = ?').run(courseId)
      db.prepare(`DELETE FROM notifications WHERE announcement_id IN (SELECT id FROM announcements WHERE course_id = ?)`).run(courseId)
      db.prepare('DELETE FROM announcements WHERE course_id = ?').run(courseId)
      db.prepare(`DELETE FROM feedback_responses WHERE feedback_id IN (SELECT id FROM feedback WHERE course_id = ?)`).run(courseId)
      db.prepare('DELETE FROM feedback WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM course_assignments WHERE course_id = ?)').run(courseId)
      db.prepare('DELETE FROM course_assignments WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM question_messages WHERE question_id IN (SELECT id FROM student_questions WHERE course_id = ?)').run(courseId)
      db.prepare('DELETE FROM student_questions WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM discussion_posts WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM certificates WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM coupons WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM teacher_course_messages WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM subscriptions WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM payment_orders WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM purchases WHERE course_id = ?').run(courseId)
      db.prepare(`DELETE FROM purchases WHERE content_id IN (SELECT id FROM content WHERE course_id = ?)`).run(courseId)
      db.prepare('DELETE FROM teacher_course_assignments WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM content WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM chapters WHERE course_id = ?').run(courseId)
      db.prepare('DELETE FROM courses WHERE id = ?').run(courseId)
    })
    remove()
    await Promise.all(items.map((item) => fs.unlink(path.join(mediaDir, item.storage_key)).catch(() => {})))
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

function contentRoute(kind) {
  const sizeLimit = kind === 'lecture' ? maxVideoBytes : maxDocumentBytes
  const routeUpload = multer({
    storage: upload.storage,
    limits: { files: 1, fileSize: sizeLimit },
  }).single('file')

  const uploadPermission = kind === 'lecture' ? 'uploadVideos' : 'uploadPdfs'
  return [requireSession, requireTeacherPermission(uploadPermission), routeUpload, async (request, response, next) => {
    let tempPath = request.file?.path
    try {
      if (!request.file) throw HttpError(400, 'Choose a file to upload.')
      const { courseId, chapterId } = request.params
      if (!safeId(courseId) || !safeId(chapterId)) throw HttpError(400, 'Invalid course or chapter id.')
      const title = String(request.body?.title || '').trim()
      if (!title || title.length > 180) throw HttpError(400, 'A title between 1 and 180 characters is required.')
      const pricePkr = 0

      const detected = await fileTypeFromFile(request.file.path)
      const originalName = cleanFileName(request.file.originalname)
      const extension = path.extname(originalName).toLowerCase()
      const validVideo = kind === 'lecture' && (
        (detected?.mime === 'video/mp4' && ['.mp4', '.m4v'].includes(extension)) ||
        (detected?.mime === 'video/webm' && extension === '.webm') ||
        (detected?.mime === 'video/quicktime' && extension === '.mov')
      )
      const validMaterial = kind === 'material' && detected?.mime === 'application/pdf' && extension === '.pdf'
      if (!validVideo && !validMaterial) throw HttpError(415, 'Only MP4/WebM/MOV videos and PDF study materials are supported right now.')

      const usedBytes = storageUsage()
      if (usedBytes + request.file.size > maxStorageBytes) throw HttpError(413, `The ${Math.floor(maxStorageBytes / 1024 ** 3)} GB media storage limit has been reached.`)

      const id = crypto.randomUUID()
      const storageKey = `${id}${extension}`
      const finalPath = path.join(mediaDir, storageKey)
      const now = new Date().toISOString()
      const quality = kind === 'lecture' ? String(request.body.quality || 'HD 1080p').slice(0, 30) : null
      const duration = kind === 'lecture' ? String(request.body.duration || '').slice(0, 30) : null

      await fs.rename(request.file.path, finalPath)
      tempPath = null
      const insert = db.transaction(() => {
        if (storageUsage() + request.file.size > maxStorageBytes) return 'storage-limit'
        db.prepare(`INSERT INTO content
          (id, course_id, chapter_id, kind, title, original_name, storage_key, mime_type, byte_size, price_pkr, created_by, quality, duration, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, courseId, chapterId, kind, title, originalName, storageKey, detected.mime, request.file.size, pricePkr, request.user.email, quality, duration, now)
        return 'ok'
      })
      const insertResult = insert()
      if (insertResult !== 'ok') {
        await fs.unlink(finalPath)
        throw HttpError(413, `The ${Math.floor(maxStorageBytes / 1024 ** 3)} GB media storage limit has been reached.`)
      }

      notifyCourseStudents(courseId, kind === 'lecture' ? 'New course lecture' : 'New study material', `${title} was added to a course you are subscribed to.`)
      response.status(201).json({
        content: { id, courseId, chapterId, kind, title, fileName: originalName, mimeType: detected.mime, size: request.file.size, pricePkr, quality, duration, createdAt: now },
      })
    } catch (error) {
      if (tempPath) await fs.unlink(tempPath).catch(() => {})
      next(error)
    }
  }]
}

app.post('/api/admin/courses/:courseId/chapters/:chapterId/lectures', ...contentRoute('lecture'))
app.post('/api/admin/courses/:courseId/chapters/:chapterId/materials', ...contentRoute('material'))

app.get('/api/admin/courses/:courseId/chapters/:chapterId/content', requireSession, requireAdmin, (request, response) => {
  const { courseId, chapterId } = request.params
  if (!safeId(courseId) || !safeId(chapterId)) throw HttpError(400, 'Invalid course or chapter id.')
  const content = db.prepare(`SELECT id, course_id AS courseId, chapter_id AS chapterId, kind, title,
    original_name AS fileName, mime_type AS mimeType, byte_size AS size, price_pkr AS pricePkr, quality, duration, created_at AS createdAt
    FROM content WHERE course_id = ? AND chapter_id = ? ORDER BY created_at`).all(courseId, chapterId)
  response.json({ content })
})

app.patch('/api/admin/content/:id', requireSession, requireContentPermission('editCourses'), (request, response, next) => {
  const item = db.prepare('SELECT id FROM content WHERE id = ?').get(request.params.id)
  if (!item) return next(HttpError(404, 'Content was not found.'))
  const title = String(request.body?.title || '').trim()
  if (!title || title.length > 180) return next(HttpError(400, 'A title between 1 and 180 characters is required.'))
  db.prepare('UPDATE content SET title = ? WHERE id = ?').run(title, item.id)
  response.json({ content: { id: item.id, title } })
})

app.get('/api/courses/:courseId/access', requireSession, (request, response, next) => {
  const course = db.prepare('SELECT id, title, price_pkr FROM courses WHERE id = ?').get(request.params.courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  const purchased = request.user.role === 'admin'
    || (request.user.role === 'teacher' && hasTeacherCourseAssignment(request.user.email, course.id))
    || (request.user.role === 'student' && hasApprovedCoursePurchase(request.user.email, course.id))
  response.json({ courseId: course.id, title: course.title, pricePkr: course.price_pkr, purchased })
})

app.get('/api/content/:id/access', requireSession, (request, response, next) => {
  const item = db.prepare('SELECT id, title, kind, price_pkr, course_id AS courseId FROM content WHERE id = ?').get(request.params.id)
  if (!item) return next(HttpError(404, 'Content was not found.'))
  const purchased = request.user.role === 'admin'
    || (request.user.role === 'teacher' && hasTeacherCourseAssignment(request.user.email, item.courseId))
    || hasApprovedCoursePurchase(request.user.email, item.courseId)
  response.json({ contentId: item.id, title: item.title, kind: item.kind, pricePkr: item.price_pkr, courseId: item.courseId, purchased })
})

app.get('/api/student/payments', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const rows = db.prepare(`SELECT po.id, po.course_id AS courseId, po.content_id AS contentId,
      COALESCE(c.title, cont.title) AS courseTitle,
      COALESCE(c.title, cont.title) AS contentTitle,
      COALESCE(c.id, cont.course_id) AS courseOrderId,
      po.amount_pkr AS amountPkr, po.status, po.bank_name AS bankName, po.account_title AS accountTitle,
      po.account_number AS accountNumber, po.transfer_reference AS transferReference, po.receipt_file AS receiptFile,
      po.method_name AS methodName, po.payment_details AS paymentDetails,
      po.coupon_code AS couponCode, po.discount_pkr AS discountPkr, po.base_amount_pkr AS baseAmountPkr,
      po.created_at AS createdAt, po.reviewed_at AS reviewedAt, po.review_note AS reviewNote
    FROM payment_orders po
    LEFT JOIN courses c ON c.id = po.course_id
    LEFT JOIN content cont ON cont.id = po.content_id
    WHERE po.student_email = ?
    ORDER BY po.created_at DESC`).all(request.user.email)
  response.json({ orders: rows })
})

app.get('/api/admin/payments', requireSession, requireAdmin, (request, response) => {
  const rows = db.prepare(`SELECT po.id, po.student_email AS studentEmail, po.course_id AS courseId, po.content_id AS contentId,
      COALESCE(c.title, cont.title) AS courseTitle, COALESCE(c.title, cont.title) AS contentTitle,
      cont.kind, po.amount_pkr AS amountPkr, po.status, po.bank_name AS bankName, po.account_title AS accountTitle,
      po.account_number AS accountNumber, po.transfer_reference AS transferReference, po.receipt_file AS receiptFile,
      po.method_name AS methodName, po.payment_details AS paymentDetails, po.receipt_mime_type AS receiptMimeType,
      po.notes, po.coupon_code AS couponCode, po.discount_pkr AS discountPkr, po.base_amount_pkr AS baseAmountPkr,
      po.created_at AS createdAt, po.reviewed_at AS reviewedAt, po.reviewed_by AS reviewedBy, po.review_note AS reviewNote
    FROM payment_orders po
    LEFT JOIN courses c ON c.id = po.course_id
    LEFT JOIN content cont ON cont.id = po.content_id
    ORDER BY po.created_at DESC`).all()
  response.json({ orders: rows })
})

app.get('/api/admin/payments/:orderId/receipt', requireSession, requireAdmin, (request, response, next) => {
  const order = db.prepare('SELECT receipt_file, receipt_mime_type FROM payment_orders WHERE id = ?')
    .get(request.params.orderId)
  if (!order?.receipt_file) return next(HttpError(404, 'Payment screenshot was not found.'))
  if (path.basename(order.receipt_file) !== order.receipt_file) return next(HttpError(400, 'Invalid payment screenshot reference.'))
  response.set({
    'Content-Type': order.receipt_mime_type || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.sendFile(order.receipt_file, { root: receiptDir, dotfiles: 'deny' }, (error) => {
    if (error && !response.headersSent) next(error)
  })
})

app.post('/api/student/courses/:courseId/payments', requireSession, (request, response, next) => {
  const contentType = String(request.headers['content-type'] || '')
  if (contentType.includes('multipart/form-data')) return paymentReceiptUpload(request, response, next)
  next()
}, async (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const course = db.prepare('SELECT id, title, price_pkr FROM courses WHERE id = ? AND published = 1').get(request.params.courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  if (hasApprovedCoursePurchase(request.user.email, course.id)) return next(HttpError(409, 'You already have access to this course.'))
  let coupon
  try {
    coupon = evaluateCoupon(request.body?.couponCode, course.id, request.user.email)
  } catch (error) {
    return next(error)
  }
  const amountPkr = course.price_pkr - coupon.discountPkr
  if (amountPkr === 0) {
    const existingOrder = db.prepare(`SELECT id FROM payment_orders
      WHERE student_email = ? AND course_id = ? AND status != 'approved' ORDER BY created_at DESC LIMIT 1`)
      .get(request.user.email, course.id)
    const orderId = existingOrder?.id || buildPaymentOrderReference()
    const createdAt = new Date().toISOString()
    const complete = db.transaction(() => {
      if (existingOrder) {
        db.prepare(`UPDATE payment_orders SET amount_pkr = 0, status = 'approved', bank_name = '', account_title = '',
          account_number = '', transfer_reference = '', created_at = ?, reviewed_at = ?, reviewed_by = 'coupon',
          review_note = NULL, coupon_code = ?, discount_pkr = ?, base_amount_pkr = ? WHERE id = ?`)
          .run(createdAt, createdAt, coupon.code, coupon.discountPkr, course.price_pkr, orderId)
      } else {
        db.prepare(`INSERT INTO payment_orders (id, student_email, course_id, content_id, amount_pkr, status,
          bank_name, account_title, account_number, transfer_reference, created_at, reviewed_at, reviewed_by,
          coupon_code, discount_pkr, base_amount_pkr)
          VALUES (?, ?, ?, NULL, 0, 'approved', '', '', '', '', ?, ?, 'coupon', ?, ?, ?)`)
          .run(orderId, request.user.email, course.id, createdAt, createdAt, coupon.code, coupon.discountPkr, course.price_pkr)
      }
      activateCourseSubscription(request.user.email, course.id, 0)
      if (coupon.couponId) {
        db.prepare('INSERT INTO coupon_redemptions (id, coupon_id, student_email, course_id, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), coupon.couponId, request.user.email, course.id, orderId, createdAt)
        db.prepare('UPDATE coupons SET uses = uses + 1 WHERE id = ?').run(coupon.couponId)
      }
    })
    complete()
    db.prepare('INSERT INTO notifications (id, recipient_email, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), request.user.email, 'Course unlocked', `Your coupon unlocked ${course.title}.`, createdAt)
    return response.status(201).json({ order: { id: orderId, status: 'approved', amountPkr: 0, discountPkr: coupon.discountPkr }, message: 'Coupon applied. Course access is active.' })
  }
  if (!request.is('multipart/form-data') || !request.file) return next(HttpError(400, 'Choose a payment screenshot before submitting.'))
  const methodsJson = db.prepare("SELECT value FROM site_settings WHERE key = 'paymentMethods'").get()?.value || '[]'
  let methods
  try {
    methods = JSON.parse(methodsJson)
  } catch (error) {
    console.error('Stored payment method settings are invalid JSON.', error)
    return next(HttpError(500, 'Payment methods could not be loaded.'))
  }
  const method = methods.find((item) => item.enabled && item.id === String(request.body?.methodId || ''))
  if (!method) return next(HttpError(400, 'Choose one of the currently available payment methods.'))
  const payerName = String(request.body?.payerName || '').trim().slice(0, 100)
  const transferReference = String(request.body?.transferReference || '').trim().slice(0, 100)
  const paymentDetails = String(request.body?.paymentDetails || '').trim().slice(0, 500)
  if (!payerName || !transferReference) return next(HttpError(400, 'Enter the payer name and payment transaction reference.'))
  const detectedType = await fileTypeFromBuffer(request.file.buffer)
  const acceptedTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
  if (!detectedType || acceptedTypes[detectedType.ext] !== detectedType.mime) {
    return next(HttpError(400, 'Payment proof must be a valid PNG, JPEG, or WebP image.'))
  }
  const existing = db.prepare(`SELECT id, receipt_file AS receiptFile FROM payment_orders WHERE student_email = ? AND course_id = ? AND status != 'approved'
    ORDER BY created_at DESC LIMIT 1`).get(request.user.email, course.id)
  const orderId = existing?.id || buildPaymentOrderReference()
  const fileName = `${orderId}.${detectedType.ext}`
  const filePath = path.join(receiptDir, fileName)
  await fs.writeFile(filePath, request.file.buffer)
  if (existing) {
    db.prepare(`UPDATE payment_orders SET amount_pkr = ?, base_amount_pkr = ?, discount_pkr = ?, coupon_code = ?,
      bank_name = '', account_title = ?, account_number = '', transfer_reference = ?, notes = ?,
      method_name = ?, payment_details = ?, receipt_file = ?, receipt_mime_type = ?,
      status = 'pending', reviewed_at = NULL, reviewed_by = NULL, review_note = NULL WHERE id = ?`)
      .run(amountPkr, course.price_pkr, coupon.discountPkr, coupon.code, payerName, transferReference, paymentDetails, method.name, paymentDetails, fileName, detectedType.mime, existing.id)
    if (existing.receiptFile && existing.receiptFile !== fileName) {
      await fs.unlink(path.join(receiptDir, path.basename(existing.receiptFile))).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Could not remove replaced payment screenshot.', error)
      })
    }
    notifyAdmins('Payment request to review', `${request.user.email} submitted a payment for ${course.title} (${amountPkr} PKR). Approve or reject it in Payments.`)
    return response.json({ order: { id: existing.id, status: 'pending', amountPkr, discountPkr: coupon.discountPkr }, message: 'Payment details updated and sent for owner review.' })
  }
  db.prepare(`INSERT INTO payment_orders (id, student_email, course_id, content_id, amount_pkr, status, bank_name, account_title,
    account_number, transfer_reference, notes, created_at, coupon_code, discount_pkr, base_amount_pkr,
    method_name, payment_details, receipt_file, receipt_mime_type)
    VALUES (?, ?, ?, NULL, ?, 'pending', '', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(orderId, request.user.email, course.id, amountPkr, payerName, transferReference, paymentDetails, new Date().toISOString(), coupon.code, coupon.discountPkr, course.price_pkr, method.name, paymentDetails, fileName, detectedType.mime)
  notifyAdmins('Payment request to review', `${request.user.email} submitted a payment for ${course.title} (${amountPkr} PKR). Approve or reject it in Payments.`)
  response.status(201).json({ order: { id: orderId, status: 'pending', amountPkr, discountPkr: coupon.discountPkr }, message: 'Course payment request created. Awaiting owner approval.' })
})

app.post('/api/student/courses/:courseId/coupon', requireSession, (request, response, next) => {
  if (request.user.role !== 'student') return next(HttpError(403, 'Student access is required.'))
  const course = db.prepare('SELECT id, price_pkr FROM courses WHERE id = ? AND published = 1').get(request.params.courseId)
  if (!course) return next(HttpError(404, 'Course was not found.'))
  if (hasApprovedCoursePurchase(request.user.email, course.id)) return next(HttpError(409, 'You already have access to this course.'))
  try {
    const coupon = evaluateCoupon(request.body?.code, course.id, request.user.email)
    response.json({ code: coupon.code, discountPkr: coupon.discountPkr, amountPkr: course.price_pkr - coupon.discountPkr })
  } catch (error) {
    next(error)
  }
})

app.post('/api/student/courses/:courseId/payments/receipt', requireSession, (_request, _response, next) => {
  next(HttpError(410, 'Upload the payment screenshot with the course payment request.'))
})

app.post('/api/student/content/:id/payments', requireSession, (request, response, next) => {
  return next(HttpError(410, 'Individual content sales are disabled. Purchase the complete course package instead.'))
})

app.post('/api/student/content/:id/payments/receipt', requireSession, async (request, response, next) => {
  return next(HttpError(410, 'Receipt submissions are attached to course purchase requests, not individual content.'))
})

app.patch('/api/admin/payments/:orderId', requireSession, requireAdmin, (request, response, next) => {
  const order = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(request.params.orderId)
  if (!order) return next(HttpError(404, 'Payment order was not found.'))
  const action = String(request.body?.action || '').trim().toLowerCase()
  const reviewNote = String(request.body?.reviewNote || '').trim().slice(0, 400)
  if (!['approve', 'reject'].includes(action)) return next(HttpError(400, 'Action must be either approve or reject.'))
  if (order.status === 'approved') return response.json({ orderId: order.id, status: 'approved', reviewNote: order.review_note, unchanged: true })
  if (action === 'approve' && !order.course_id) return next(HttpError(409, 'This legacy payment is not for a course package and cannot grant course access.'))
  const nextStatus = action === 'approve' ? 'approved' : 'rejected'
  let coupon = null
  if (action === 'approve' && order.coupon_code) {
    coupon = db.prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE').get(order.coupon_code)
    if (!coupon || !coupon.active || (coupon.expires_at && coupon.expires_at <= new Date().toISOString())
      || (coupon.max_uses !== null && coupon.uses >= coupon.max_uses)
      || db.prepare('SELECT 1 FROM coupon_redemptions WHERE coupon_id = ? AND student_email = ? AND course_id = ?')
        .get(coupon.id, order.student_email, order.course_id)) {
      return next(HttpError(409, 'The coupon is no longer eligible; reject this request and ask the student to resubmit without it.'))
    }
  }
  const review = db.transaction(() => {
    db.prepare(`UPDATE payment_orders SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?`)
      .run(nextStatus, new Date().toISOString(), request.user.email, reviewNote, order.id)
    if (action === 'approve' && order.course_id) {
      activateCourseSubscription(order.student_email, order.course_id, order.amount_pkr)
      if (coupon) {
        db.prepare(`INSERT INTO coupon_redemptions (id, coupon_id, student_email, course_id, order_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), coupon.id, order.student_email, order.course_id, order.id, new Date().toISOString())
        db.prepare('UPDATE coupons SET uses = uses + 1 WHERE id = ?').run(coupon.id)
      }
    }
  })
  review()
  const courseTitle = order.course_id ? db.prepare('SELECT title FROM courses WHERE id = ?').get(order.course_id)?.title : null
  db.prepare(`INSERT INTO notifications (id, recipient_email, title, body, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    order.student_email,
    nextStatus === 'approved' ? 'Course payment approved' : 'Course payment needs attention',
    nextStatus === 'approved'
      ? `Your payment for ${courseTitle || 'the course'} was approved. Course access is now active.`
      : `Your payment for ${courseTitle || 'the course'} was rejected.${reviewNote ? ` Review note: ${reviewNote}` : ''}`,
    new Date().toISOString(),
  )
  response.json({ orderId: order.id, status: nextStatus, reviewNote })
})


app.delete('/api/admin/courses/:courseId/content', requireSession, requireAdmin, async (request, response, next) => {
  try {
    const { courseId } = request.params
    if (!safeId(courseId)) throw HttpError(400, 'Invalid course id.')
    const items = db.prepare('SELECT id, storage_key FROM content WHERE course_id = ?').all(courseId)
    const remove = db.transaction(() => {
      db.prepare('UPDATE live_classes SET recording_content_id = NULL WHERE recording_content_id IN (SELECT id FROM content WHERE course_id = ?)').run(courseId)
      db.prepare('DELETE FROM content WHERE course_id = ?').run(courseId)
    })
    remove()
    await Promise.all(items.map((item) => fs.unlink(path.join(mediaDir, item.storage_key)).catch(() => {})))
    response.json({ removed: items.length })
  } catch (error) {
    next(error)
  }
})

app.get('/api/content/:id/stream', requireSession, async (request, response, next) => {
  try {
    const item = db.prepare('SELECT * FROM content WHERE id = ?').get(request.params.id)
    if (!item) throw HttpError(404, 'Content was not found.')
    const isAdmin = request.user.role === 'admin'
    const hasPurchased = request.user.role === 'student'
      && hasApprovedCoursePurchase(request.user.email, item.course_id)
    const isAssignedTeacher = request.user.role === 'teacher' && hasTeacherCourseAssignment(request.user.email, item.course_id, item.chapter_id)
    if (!isAdmin && !isAssignedTeacher && !hasPurchased) throw HttpError(402, 'An active course subscription is required to access this content.')

    response.set({
      'Content-Type': item.mime_type,
      'Content-Disposition': `inline; filename="${cleanFileName(item.original_name)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    })
    response.sendFile(item.storage_key, { root: mediaDir, acceptRanges: true, cacheControl: false, dotfiles: 'deny' }, (error) => {
      if (error && !response.headersSent) next(error)
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/content/:id', requireSession, requireContentPermission('deleteContent'), async (request, response, next) => {
  try {
    const item = db.prepare('SELECT storage_key FROM content WHERE id = ?').get(request.params.id)
    if (!item) throw HttpError(404, 'Content was not found.')
    db.prepare('UPDATE live_classes SET recording_content_id = NULL WHERE recording_content_id = ?').run(request.params.id)
    db.prepare('DELETE FROM content WHERE id = ?').run(request.params.id)
    await fs.unlink(path.join(mediaDir, item.storage_key)).catch(() => {})
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/storage', requireSession, requireAdmin, (_request, response) => {
  response.json({ usedBytes: storageUsage(), limitBytes: maxStorageBytes })
})

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return response.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the upload limit.' : error.message })
  }
  const status = Number(error.status) || 500
  if (status >= 500) console.error(error)
  const message = status >= 500 && status !== 502 && status !== 503
    ? 'The service encountered an error.'
    : error.message
  response.status(status).json({ error: message })
})

const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'
app.listen(port, host, () => {
  console.log(`Lessonwell API listening at http://${host}:${port}`)
  console.log(`Private media storage: ${mediaDir}`)
  if (process.env.ALLOW_DEV_SESSIONS === 'true') console.warn('Development sessions are enabled; disable them before production.')
})
