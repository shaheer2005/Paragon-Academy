import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminEmail = 'test-admin@example.invalid'
const adminPassword = 'Local-Test-Only-Password-9342'
const teacherEmail = 'test-teacher@example.invalid'
const teacherPassword = 'Local-Teacher-Password-9342'
const studentEmail = 'test-student@example.invalid'
const studentPassword = 'Local-Student-Password-9342'

async function reservePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForApi(baseUrl, process, getOutput) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`API exited before becoming healthy:\n${getOutput()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`API did not become healthy:\n${getOutput()}`)
}

async function stopProcess(process) {
  if (process.exitCode !== null) return
  const exited = once(process, 'exit')
  process.kill()
  let timeout
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('API process did not stop')), 5_000) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

test('API authentication, role access, and course workflows', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'teaching-platform-test-'))
  const dataDir = path.join(tempRoot, 'data')
  const mediaDir = path.join(tempRoot, 'media')
  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const apiProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      API_PORT: String(port),
      API_DATA_DIR: dataDir,
      MEDIA_STORAGE_DIR: mediaDir,
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      ADMIN_NAME: 'Integration Test Admin',
      ALLOW_DEV_SESSIONS: 'false',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  apiProcess.stdout.setEncoding('utf8').on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })
  apiProcess.stderr.setEncoding('utf8').on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })

  async function request(route, { method = 'GET', body, formData, cookie } = {}) {
    const headers = new Headers()
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (cookie) headers.set('Cookie', cookie)
    const requestBody = formData ?? (body === undefined ? undefined : JSON.stringify(body))
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      ...(requestBody === undefined ? {} : { body: requestBody }),
    })
    const text = await response.text()
    return {
      status: response.status,
      body: !text ? null : response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text,
      cookie: response.headers.get('set-cookie')?.split(';', 1)[0],
    }
  }

  try {
    await waitForApi(baseUrl, apiProcess, () => output)

    await t.test('health reports an empty isolated database', async () => {
      const result = await request('/api/health')
      assert.equal(result.status, 200)
      assert.equal(result.body.status, 'ok')
      assert.equal(result.body.storage.usedBytes, 0)
    })

    await t.test('authentication validates requests and rejects anonymous sessions', async () => {
      assert.equal((await request('/api/auth/me')).status, 401)
      assert.equal((await request('/api/auth/login', { method: 'POST', body: {} })).status, 400)
      assert.equal((await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'missing@example.invalid', password: 'wrong-password', role: 'admin' },
      })).status, 401)
    })

    let studentCookie
    await t.test('student can sign in and create an account without email delivery', async () => {
      const salt = 'integration-test-salt'
      const db = new Database(path.join(dataDir, 'lessonwell.sqlite'))
      db.prepare(`INSERT INTO users (email, name, role, password_salt, password_hash, created_at)
        VALUES (?, ?, 'student', ?, ?, ?)`)
        .run(studentEmail, 'Integration Test Student', salt, scryptSync(studentPassword, salt, 64).toString('hex'), new Date().toISOString())
      db.close()

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: studentEmail, password: studentPassword, role: 'student' },
      })
      assert.equal(login.status, 200)
      assert.equal(login.body.user.role, 'student')
      assert.ok(login.cookie)
      studentCookie = login.cookie
      assert.equal((await request('/api/student/courses', { cookie: studentCookie })).status, 200)

      const signup = await request('/api/auth/signup', {
        method: 'POST',
        body: {
          name: 'New Student',
          email: 'new-student@example.invalid',
          password: 'Local-New-Student-Password-9342',
          role: 'student',
        },
      })
      assert.equal(signup.status, 201)
      assert.equal(signup.body.user.email, 'new-student@example.invalid')
      assert.equal(signup.body.user.role, 'student')
      assert.ok(signup.cookie)
      assert.equal((await request('/api/auth/me', { cookie: signup.cookie })).body.user.email, 'new-student@example.invalid')
      assert.equal((await request('/api/auth/signup', {
        method: 'POST',
        body: {
          name: 'New Student',
          email: 'new-student@example.invalid',
          password: 'Local-New-Student-Password-9342',
        },
      })).status, 409)
    })

    await t.test('password reset rejects unconfigured email and accepts a valid reset code', async () => {
      const resetRequest = await request('/api/auth/reset/request', {
        method: 'POST',
        body: { email: studentEmail, role: 'student' },
      })
      assert.equal(resetRequest.status, 503)
      assert.match(resetRequest.body.error, /Email delivery is not configured/)

      const otp = '123456'
      const db = new Database(path.join(dataDir, 'lessonwell.sqlite'))
      db.prepare(`INSERT INTO auth_challenges (email, purpose, otp_hash, expires_at)
        VALUES (?, 'reset', ?, ?)
        ON CONFLICT(email, purpose) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at`)
        .run(studentEmail, createHash('sha256').update(otp).digest('hex'), Date.now() + 60_000)
      db.close()

      const reset = await request('/api/auth/reset/confirm', {
        method: 'POST',
        body: { email: studentEmail, otp, password: 'Local-Student-Reset-Password-9342' },
      })
      assert.equal(reset.status, 200)
      assert.equal(reset.body.user.email, studentEmail)
      assert.ok(reset.cookie)
      assert.equal((await request('/api/auth/login', {
        method: 'POST',
        body: { email: studentEmail, password: studentPassword, role: 'student' },
      })).status, 401)
      assert.equal((await request('/api/auth/login', {
        method: 'POST',
        body: { email: studentEmail, password: 'Local-Student-Reset-Password-9342', role: 'student' },
      })).status, 200)
    })

    let adminCookie
    await t.test('admin can sign in and retrieve the admin course list', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: adminEmail, password: adminPassword, role: 'admin' },
      })
      assert.equal(login.status, 200)
      assert.equal(login.body.user.role, 'admin')
      assert.ok(login.cookie)
      adminCookie = login.cookie
      assert.equal((await request('/api/auth/me', { cookie: adminCookie })).body.user.email, adminEmail)
      assert.equal((await request('/api/admin/courses', { cookie: adminCookie })).body.courses.length, 0)
    })

    let courseId
    await t.test('course validation, chapter creation, and publishing rules work', async () => {
      assert.equal((await request('/api/admin/courses', {
        method: 'POST',
        cookie: adminCookie,
        body: { title: '', price: -2 },
      })).status, 400)

      const created = await request('/api/admin/courses', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          title: 'Integration Course',
          description: 'Course created by the automated API test',
          category: 'Testing',
          subject: 'QA',
          classLevel: '1',
          price: 2500,
          subscriptionDays: 30,
        },
      })
      assert.equal(created.status, 201)
      courseId = created.body.course.id
      const studentCoursesBeforePublish = await request('/api/student/courses', { cookie: studentCookie })
      assert.equal(studentCoursesBeforePublish.status, 200)
      assert.equal(studentCoursesBeforePublish.body.courses.some((course) => course.id === courseId), false)

      assert.equal((await request(`/api/admin/courses/${courseId}/publish`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { published: true },
      })).status, 409)

      const chapter = await request(`/api/admin/courses/${courseId}/chapters`, {
        method: 'POST',
        cookie: adminCookie,
        body: { title: 'Chapter One', topic: 'Basics' },
      })
      assert.equal(chapter.status, 201)
      assert.equal((await request(`/api/admin/courses/${courseId}/publish`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { published: true },
      })).body.published, true)
      const studentCoursesAfterPublish = await request('/api/student/courses', { cookie: studentCookie })
      assert.equal(studentCoursesAfterPublish.status, 200)
      assert.equal(studentCoursesAfterPublish.body.courses.some((course) => course.id === courseId), true)
    })

    await t.test('configured payment method submits a request and admin approval unlocks the course', async () => {
      const paymentMethod = {
        id: 'integration-bank',
        name: 'Integration Bank Transfer',
        instructions: 'Use the test account details.',
        enabled: true,
      }
      const savedSettings = await request('/api/admin/settings', {
        method: 'PATCH',
        cookie: adminCookie,
        body: { settings: { paymentMethods: [paymentMethod] } },
      })
      assert.equal(savedSettings.status, 200)
      assert.deepEqual(savedSettings.body.settings.paymentMethods, [paymentMethod])

      const availableMethods = await request('/api/payment-methods', { cookie: studentCookie })
      assert.equal(availableMethods.status, 200)
      assert.deepEqual(availableMethods.body.methods, [paymentMethod])

      const paymentProof = new FormData()
      paymentProof.set('methodId', paymentMethod.id)
      paymentProof.set('payerName', 'Integration Test Student')
      paymentProof.set('transferReference', 'TEST-TRANSFER-2026')
      paymentProof.set('paymentDetails', 'Automated integration test payment.')
      paymentProof.set('receipt', new Blob([
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f1sAAAAASUVORK5CYII=', 'base64'),
      ], { type: 'image/png' }), 'payment-proof.png')

      const submitted = await request(`/api/student/courses/${courseId}/payments`, {
        method: 'POST',
        cookie: studentCookie,
        formData: paymentProof,
      })
      assert.equal(submitted.status, 201)
      assert.equal(submitted.body.order.status, 'pending')
      const orderId = submitted.body.order.id

      const studentCourseWhilePending = await request('/api/student/courses', { cookie: studentCookie })
      const courseWhilePending = studentCourseWhilePending.body.courses.find((course) => course.id === courseId)
      assert.equal(courseWhilePending.purchased, false)
      const studentPayments = await request('/api/student/payments', { cookie: studentCookie })
      assert.equal(studentPayments.body.orders.find((order) => order.id === orderId).status, 'pending')

      const adminPayments = await request('/api/admin/payments', { cookie: adminCookie })
      const orderForReview = adminPayments.body.orders.find((order) => order.id === orderId)
      assert.equal(orderForReview.status, 'pending')
      assert.equal(orderForReview.methodName, paymentMethod.name)
      assert.equal(orderForReview.transferReference, 'TEST-TRANSFER-2026')
      const receipt = await request(`/api/admin/payments/${orderId}/receipt`, { cookie: adminCookie })
      assert.equal(receipt.status, 200)

      const approved = await request(`/api/admin/payments/${orderId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { action: 'approve' },
      })
      assert.equal(approved.status, 200)
      assert.equal(approved.body.status, 'approved')
      const studentCourseAfterApproval = await request('/api/student/courses', { cookie: studentCookie })
      const courseAfterApproval = studentCourseAfterApproval.body.courses.find((course) => course.id === courseId)
      assert.equal(courseAfterApproval.purchased, true)
      assert.equal(courseAfterApproval.subscription.status, 'active')
      const approvedStudentPayments = await request('/api/student/payments', { cookie: studentCookie })
      assert.equal(approvedStudentPayments.body.orders.find((order) => order.id === orderId).status, 'approved')
    })

    let teacherCookie
    await t.test('teacher creation, permissions, assignment, and role restrictions work', async () => {
      const created = await request('/api/admin/teachers', {
        method: 'POST',
        cookie: adminCookie,
        body: { name: 'Test Teacher', email: teacherEmail, password: teacherPassword },
      })
      assert.equal(created.status, 201)
      assert.equal((await request('/api/admin/teachers', {
        method: 'POST',
        cookie: adminCookie,
        body: { name: 'Test Teacher', email: teacherEmail, password: teacherPassword },
      })).status, 409)

      assert.equal((await request(`/api/admin/teachers/${teacherEmail}/permissions`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { permissions: { unknownPermission: true } },
      })).status, 400)
      const permissions = await request(`/api/admin/teachers/${teacherEmail}/permissions`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { permissions: {
          uploadVideos: true,
          createQuizzes: true,
          manageAssignments: true,
          scheduleLiveClasses: true,
          viewAttendance: true,
          manageFeedback: true,
          manageDiscussions: true,
        } },
      })
      assert.equal(permissions.status, 200)
      assert.equal(permissions.body.permissions.uploadVideos, true)
      assert.equal(permissions.body.permissions.createQuizzes, true)
      assert.equal(permissions.body.permissions.manageAssignments, true)
      assert.equal(permissions.body.permissions.scheduleLiveClasses, true)
      assert.equal(permissions.body.permissions.viewAttendance, true)
      assert.equal(permissions.body.permissions.manageFeedback, true)
      assert.equal(permissions.body.permissions.manageDiscussions, true)

      assert.equal((await request(`/api/admin/teachers/${teacherEmail}/assignments`, {
        method: 'POST',
        cookie: adminCookie,
        body: { courseId, chapterId: 'not-a-chapter' },
      })).status, 400)
      const assignment = await request(`/api/admin/teachers/${teacherEmail}/assignments`, {
        method: 'POST',
        cookie: adminCookie,
        body: { courseId },
      })
      assert.equal(assignment.status, 201)
      assert.equal((await request(`/api/admin/teachers/${teacherEmail}/assignments`, {
        method: 'POST',
        cookie: adminCookie,
        body: { courseId },
      })).status, 200)

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: teacherEmail, password: teacherPassword, role: 'teacher' },
      })
      assert.equal(login.status, 200)
      teacherCookie = login.cookie
      assert.ok(teacherCookie)
      assert.equal((await request('/api/teacher/courses', { cookie: teacherCookie })).status, 200)
      assert.equal((await request('/api/admin/courses', { cookie: teacherCookie })).status, 403)
    })

    await t.test('student assignments can be submitted, reviewed, and viewed', async () => {
      const created = await request(`/api/courses/${courseId}/assignments`, {
        method: 'POST',
        cookie: teacherCookie,
        body: { title: 'Integration Assignment', instructions: 'Explain the solution.', points: 20 },
      })
      assert.equal(created.status, 201)
      const assignmentId = created.body.assignment.id
      const published = await request(`/api/assignments/${assignmentId}/publish`, {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { published: true },
      })
      assert.equal(published.status, 200)
      assert.equal(published.body.published, true)

      const studentAssignments = await request(`/api/courses/${courseId}/assignments`, { cookie: studentCookie })
      assert.equal(studentAssignments.status, 200)
      assert.equal(studentAssignments.body.assignments.some((assignment) => assignment.id === assignmentId), true)
      const submitted = await request(`/api/assignments/${assignmentId}/submissions`, {
        method: 'POST',
        cookie: studentCookie,
        body: { answer: 'The worked solution is 42.' },
      })
      assert.equal(submitted.status, 201)
      assert.equal(submitted.body.submission.answer, 'The worked solution is 42.')

      const teacherAssignments = await request(`/api/courses/${courseId}/assignments`, { cookie: teacherCookie })
      const submission = teacherAssignments.body.assignments.find((assignment) => assignment.id === assignmentId).submissions[0]
      assert.equal(submission.studentEmail, studentEmail)
      const reviewed = await request(`/api/assignments/${assignmentId}/submissions/${submission.id}/review`, {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { grade: 18, feedback: 'Good explanation.' },
      })
      assert.equal(reviewed.status, 200)
      assert.equal(reviewed.body.grade, 18)

      const reviewedStudentAssignment = await request(`/api/courses/${courseId}/assignments`, { cookie: studentCookie })
      const ownSubmission = reviewedStudentAssignment.body.assignments.find((assignment) => assignment.id === assignmentId).submission
      assert.equal(ownSubmission.grade, 18)
      assert.equal(ownSubmission.feedback, 'Good explanation.')
    })

    await t.test('student attendance can be marked and viewed by student and authorized teacher', async () => {
      const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      const created = await request(`/api/courses/${courseId}/live-classes`, {
        method: 'POST',
        cookie: teacherCookie,
        body: { title: 'Attendance Integration Class', startsAt, meetingUrl: 'https://example.invalid/class' },
      })
      assert.equal(created.status, 201)
      const liveClassId = created.body.liveClass.id

      const upcomingClasses = await request('/api/student/live-classes', { cookie: studentCookie })
      assert.equal(upcomingClasses.status, 200)
      assert.equal(upcomingClasses.body.classes.some((liveClass) => liveClass.id === liveClassId), true)
      const marked = await request(`/api/live-classes/${liveClassId}/attendance`, {
        method: 'POST',
        cookie: studentCookie,
        body: {},
      })
      assert.equal(marked.status, 200)
      assert.equal(marked.body.attended, true)

      const studentAttendance = await request('/api/student/attendance', { cookie: studentCookie })
      assert.equal(studentAttendance.body.attendance.some((attendance) => attendance.liveClassId === liveClassId), true)
      const teacherAttendance = await request(`/api/live-classes/${liveClassId}/attendance`, { cookie: teacherCookie })
      assert.equal(teacherAttendance.status, 200)
      assert.equal(teacherAttendance.body.attendance.find((attendance) => attendance.studentEmail === studentEmail).attended, 1)
    })

    await t.test('course discussions support student posts, replies, and teacher moderation', async () => {
      const created = await request(`/api/courses/${courseId}/discussions`, {
        method: 'POST',
        cookie: studentCookie,
        body: { title: 'Integration Discussion', body: 'I have a question about this course.' },
      })
      assert.equal(created.status, 201)
      const postId = created.body.post.id

      const reply = await request(`/api/courses/${courseId}/discussions`, {
        method: 'POST',
        cookie: teacherCookie,
        body: { parentId: postId, body: 'Here is a helpful explanation.' },
      })
      assert.equal(reply.status, 201)

      const resolved = await request(`/api/discussions/${postId}/status`, {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { status: 'resolved' },
      })
      assert.equal(resolved.status, 200)
      assert.equal(resolved.body.status, 'resolved')
      const list = await request(`/api/courses/${courseId}/discussions`, { cookie: studentCookie })
      const post = list.body.discussions.find((discussion) => discussion.id === postId)
      assert.equal(post.status, 'resolved')
      assert.equal(post.replies[0].body, 'Here is a helpful explanation.')
    })

    await t.test('student feedback can be submitted and answered by assigned teacher', async () => {
      const created = await request('/api/student/feedback', {
        method: 'POST',
        cookie: studentCookie,
        body: { courseId, teacherEmail, rating: 5, comment: 'Clear and useful course.' },
      })
      assert.equal(created.status, 201)
      const feedbackId = created.body.feedback.id

      const teacherFeedback = await request('/api/feedback', { cookie: teacherCookie })
      assert.equal(teacherFeedback.status, 200)
      assert.equal(teacherFeedback.body.feedback.some((item) => item.id === feedbackId), true)
      const reply = await request(`/api/feedback/${feedbackId}/replies`, {
        method: 'POST',
        cookie: teacherCookie,
        body: { body: 'Thank you for your feedback.' },
      })
      assert.equal(reply.status, 201)
      const studentFeedback = await request('/api/feedback', { cookie: studentCookie })
      const feedback = studentFeedback.body.feedback.find((item) => item.id === feedbackId)
      assert.equal(feedback.responses[0].body, 'Thank you for your feedback.')
    })

    let assessmentId
    await t.test('teacher can create and publish a valid quiz only with valid questions', async () => {
      const invalid = await request(`/api/courses/${courseId}/assessments`, {
        method: 'POST',
        cookie: teacherCookie,
        body: {
          kind: 'quiz',
          title: 'Invalid Quiz',
          durationMinutes: 0,
          questions: [{ prompt: '', options: ['Only one option'], correctIndex: 0 }],
        },
      })
      assert.equal(invalid.status, 400)

      const created = await request(`/api/courses/${courseId}/assessments`, {
        method: 'POST',
        cookie: teacherCookie,
        body: {
          kind: 'quiz',
          title: 'Integration Quiz',
          durationMinutes: 10,
          questions: [{ prompt: '2 + 2?', options: ['3', '4'], correctIndex: 1 }],
        },
      })
      assert.equal(created.status, 201)
      assessmentId = created.body.assessment.id
      const published = await request(`/api/assessments/${assessmentId}/publish`, {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { published: true },
      })
      assert.equal(published.status, 200)
      assert.equal(published.body.published, true)
    })

    await t.test('student can take a published quiz and receive a correct score', async () => {
      const available = await request(`/api/courses/${courseId}/assessments`, { cookie: studentCookie })
      assert.equal(available.status, 200)
      const quiz = available.body.assessments.find((assessment) => assessment.id === assessmentId)
      assert.ok(quiz)
      assert.equal(quiz.questions[0].correctIndex, null)

      const attempt = await request(`/api/assessments/${assessmentId}/attempts`, {
        method: 'POST',
        cookie: studentCookie,
        body: {},
      })
      assert.equal(attempt.status, 201)
      assert.equal(attempt.body.questions.length, 1)

      const submitted = await request(`/api/assessment-attempts/${attempt.body.attemptId}/submit`, {
        method: 'POST',
        cookie: studentCookie,
        body: { answers: { [attempt.body.questions[0].id]: attempt.body.questions[0].options.indexOf('4') } },
      })
      assert.equal(submitted.status, 200)
      assert.equal(submitted.body.score, 1)
      assert.equal(submitted.body.total, 1)
      assert.equal(submitted.body.percentage, 100)
    })

    await t.test('certificate issuance requires course completion and public verification works', async () => {
      const earlyCertificate = await request(`/api/student/courses/${courseId}/certificate`, {
        method: 'POST',
        cookie: studentCookie,
        body: {},
      })
      assert.equal(earlyCertificate.status, 409)

      const db = new Database(path.join(dataDir, 'lessonwell.sqlite'))
      const chapter = db.prepare('SELECT id FROM chapters WHERE course_id = ? LIMIT 1').get(courseId)
      const lectureId = 'integration-completion-lecture'
      db.prepare(`INSERT INTO content
        (id, course_id, chapter_id, kind, title, original_name, storage_key, mime_type, byte_size, created_by, created_at)
        VALUES (?, ?, ?, 'lecture', ?, ?, ?, ?, ?, ?, ?)`)
        .run(lectureId, courseId, chapter.id, 'Completion Lesson', 'lesson.mp4', 'integration-lesson.mp4',
          'video/mp4', 1, teacherEmail, new Date().toISOString())
      db.close()

      const progress = await request(`/api/student/content/${lectureId}/progress`, {
        method: 'POST',
        cookie: studentCookie,
        body: { watchedSeconds: 120, completed: true },
      })
      assert.equal(progress.status, 200)
      assert.equal(progress.body.completed, true)

      const eligibleCertificates = await request('/api/student/certificates', { cookie: studentCookie })
      const eligibility = eligibleCertificates.body.certificates.find((certificate) => certificate.courseId === courseId)
      assert.equal(eligibility.eligible, true)
      assert.equal(eligibility.completeCount, 1)
      assert.equal(eligibility.missedAssessments, 0)

      const issued = await request(`/api/student/courses/${courseId}/certificate`, {
        method: 'POST',
        cookie: studentCookie,
        body: {},
      })
      assert.equal(issued.status, 201)
      const certificateId = issued.body.certificate.id
      const code = issued.body.certificate.verificationCode
      assert.match(code, /^[A-F0-9]+$/)

      const repeatedIssue = await request(`/api/student/courses/${courseId}/certificate`, {
        method: 'POST',
        cookie: studentCookie,
        body: {},
      })
      assert.equal(repeatedIssue.status, 201)
      assert.equal(repeatedIssue.body.certificate.id, certificateId)
      const verified = await request(`/api/certificates/${code.toLowerCase()}`)
      assert.equal(verified.status, 200)
      assert.equal(verified.body.certificate.studentName, 'Integration Test Student')
      assert.equal(verified.body.certificate.courseTitle, 'Integration Course')
      const printable = await request(`/api/certificates/${code}/print`)
      assert.equal(printable.status, 200)
      assert.match(printable.body, /Certificate of Achievement/)
      assert.equal((await request('/api/certificates/not-a-real-code')).status, 404)
    })

    await t.test('logout revokes the session and protected storage remains admin-only', async () => {
      assert.equal((await request('/api/admin/storage', { cookie: adminCookie })).status, 200)
      assert.equal((await request('/api/admin/storage', { cookie: teacherCookie })).status, 403)
      assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: adminCookie })).status, 204)
      assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 401)
    })
  } finally {
    await stopProcess(apiProcess)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('signup works without email delivery in development and production', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'teaching-platform-signup-mode-test-'))
  const apiProcesses = []

  async function startApi(mode, name) {
    const port = await reservePort()
    const dataDir = path.join(tempRoot, `${name}-data`)
    const mediaDir = path.join(tempRoot, `${name}-media`)
    const apiProcess = spawn(process.execPath, ['server/index.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: mode,
        API_PORT: String(port),
        API_DATA_DIR: dataDir,
        MEDIA_STORAGE_DIR: mediaDir,
        ALLOW_DEV_SESSIONS: 'true',
        RESEND_API_KEY: '',
        RESEND_FROM_EMAIL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    apiProcess.stdout.setEncoding('utf8').on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })
    apiProcess.stderr.setEncoding('utf8').on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })
    apiProcesses.push(apiProcess)
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForApi(baseUrl, apiProcess, () => output)
    return baseUrl
  }

  async function request(baseUrl, route, body, cookie) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers.get('set-cookie')?.split(';', 1)[0],
    }
  }

  try {
    const developmentUrl = await startApi('test', 'development')
    const signup = await request(developmentUrl, '/api/auth/signup', {
      name: 'Local Student',
      email: 'local-student@example.invalid',
      password: 'Local-Student-Password-9342',
    })
    assert.equal(signup.status, 201)
    assert.equal(signup.body.user.role, 'student')
    assert.match(signup.body.message, /created successfully/)
    assert.ok(signup.cookie)
    assert.equal((await request(developmentUrl, '/api/auth/me', undefined, signup.cookie)).body.user.email, 'local-student@example.invalid')

    const productionUrl = await startApi('production', 'production')
    const productionSignup = await request(productionUrl, '/api/auth/signup', {
      name: 'Production Student',
      email: 'production-student@example.invalid',
      password: 'Production-Student-Password-9342',
    })
    assert.equal(productionSignup.status, 201)
    assert.equal(productionSignup.body.user.role, 'student')
    assert.ok(productionSignup.cookie)
    assert.equal((await request(productionUrl, '/api/auth/me', undefined, productionSignup.cookie)).body.user.email, 'production-student@example.invalid')
  } finally {
    await Promise.all(apiProcesses.map(stopProcess))
    await rm(tempRoot, { recursive: true, force: true })
  }
})
