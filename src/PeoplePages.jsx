import { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, Check, Plus, ShieldCheck, Users } from 'lucide-react'

const permissionOptions = [
  ['uploadVideos', 'Upload video lectures'],
  ['uploadPdfs', 'Upload PDF notes'],
  ['createQuizzes', 'Create quizzes'],
  ['createTests', 'Create tests'],
  ['scheduleLiveClasses', 'Schedule live classes'],
  ['viewStudentProgress', 'View student progress'],
  ['viewAttendance', 'View attendance'],
  ['editCourses', 'Edit course content'],
  ['deleteContent', 'Delete own uploads'],
  ['manageAssignments', 'Create assignments and review submissions'],
  ['manageStudents', 'Manage assigned students'],
  ['managePayments', 'View assigned-course payments'],
  ['manageFeedback', 'View assigned-course feedback'],
  ['sendAnnouncements', 'Send course announcements'],
  ['manageDiscussions', 'Moderate course discussions'],
  ['manageMessages', 'Receive private student questions'],
]

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const result = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result
}

export function TeachersPage({ courses, onNotify }) {
  const [teachers, setTeachers] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedChapter, setSelectedChapter] = useState('')

  async function loadTeachers() {
    try {
      const result = await apiRequest('/api/admin/teachers')
      setTeachers(result.teachers || [])
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  useEffect(() => {
    let active = true
    apiRequest('/api/admin/teachers')
      .then((result) => { if (active) setTeachers(result.teachers || []) })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])

  async function createTeacher(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const fields = new FormData(formElement)
    setBusy(true)
    try {
      await apiRequest('/api/admin/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(fields.get('name')).trim(),
          email: String(fields.get('email')).trim(),
          phone: String(fields.get('phone')).trim(),
          password: String(fields.get('password')),
        }),
      })
      formElement.reset()
      await loadTeachers()
      onNotify('Teacher account created. Assign courses and permissions before sharing the login details.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function updatePermissions(teacher, permission, enabled) {
    const permissions = { ...teacher.permissions, [permission]: enabled }
    try {
      await apiRequest(`/api/admin/teachers/${encodeURIComponent(teacher.email)}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      })
      setTeachers((current) => current.map((item) => item.email === teacher.email ? { ...item, permissions } : item))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function assignCourse(event, teacher) {
    event.preventDefault()
    if (!selectedCourse) return
    try {
      await apiRequest(`/api/admin/teachers/${encodeURIComponent(teacher.email)}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: selectedCourse, chapterId: selectedChapter || null }),
      })
      setSelectedChapter('')
      await loadTeachers()
      onNotify('Course assignment saved.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function removeAssignment(teacher, assignmentId) {
    try {
      await apiRequest(`/api/admin/teachers/${encodeURIComponent(teacher.email)}/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' })
      await loadTeachers()
      onNotify('Course assignment removed.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function toggleActive(teacher) {
    try {
      const result = await apiRequest(`/api/admin/teachers/${encodeURIComponent(teacher.email)}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !teacher.active }),
      })
      setTeachers((current) => current.map((item) => item.email === teacher.email ? { ...item, active: result.active } : item))
      onNotify(result.active ? 'Teacher account reactivated.' : 'Teacher account deactivated and sessions revoked.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const chapters = courses.find((course) => course.id === selectedCourse)?.chapters || []

  return <>
    <header className="page-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h1>Teachers & permissions</h1><p className="page-description">Create instructor accounts, assign course or chapter scope, and grant only the capabilities each teacher needs.</p></div></header>
    <form className="panel people-create-form" onSubmit={createTeacher}>
      <h2><Plus size={17} />Create teacher account</h2>
      <div className="people-create-fields">
        <label className="form-field"><span>Full name</span><input name="name" autoComplete="name" required maxLength="100" /></label>
        <label className="form-field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
        <label className="form-field"><span>Phone</span><input name="phone" type="tel" /></label>
        <label className="form-field"><span>Initial password</span><input name="password" type="password" minLength="8" required autoComplete="new-password" /></label>
      </div>
      <button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create instructor'}<ArrowRight size={15} /></button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {teachers.length ? <div className="people-list">{teachers.map((teacher) => <section className="panel teacher-card" key={teacher.email}>
      <div className="teacher-card-heading">
        <div><span className="people-avatar"><ShieldCheck size={17} /></span><span><strong>{teacher.name}</strong><small>{teacher.email}{teacher.phone ? ` · ${teacher.phone}` : ''}</small></span></div>
        <button className="button button-outline" type="button" onClick={() => toggleActive(teacher)}>{teacher.active ? 'Deactivate' : 'Reactivate'}</button>
      </div>
      <h3>Course and chapter assignments</h3>
      <form className="assignment-form" onSubmit={(event) => assignCourse(event, teacher)}>
        <select aria-label="Course to assign" value={selectedCourse} onChange={(event) => { setSelectedCourse(event.target.value); setSelectedChapter('') }}>
          <option value="">Select a course</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}
        </select>
        <select aria-label="Optional chapter assignment" value={selectedChapter} onChange={(event) => setSelectedChapter(event.target.value)}>
          <option value="">Entire course</option>{chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}
        </select>
        <button className="button button-outline" type="submit" disabled={!selectedCourse}>Assign</button>
      </form>
      <div className="assignment-chips">{teacher.assignments.map((assignment) => <span className="assignment-chip" key={assignment.id}>
        {assignment.courseTitle}{assignment.chapterTitle ? ` · ${assignment.chapterTitle}` : ' · all chapters'}
        <button type="button" aria-label={`Remove ${assignment.courseTitle} assignment`} onClick={() => removeAssignment(teacher, assignment.id)}>×</button>
      </span>)}{!teacher.assignments.length && <small>No course access assigned.</small>}</div>
      <h3>Individual permissions</h3>
      <div className="permission-grid">{permissionOptions.map(([key, label]) => <label className="permission-toggle" key={key}>
        <input type="checkbox" checked={Boolean(teacher.permissions[key])} onChange={(event) => updatePermissions(teacher, key, event.target.checked)} />
        <span>{label}</span>
      </label>)}</div>
    </section>)}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Users size={21} /></div><h3>No teachers created</h3><p>Only the owner can provision new teacher accounts.</p></div></div>}
  </>
}

export function StudentsPage({ onNotify }) {
  const [students, setStudents] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiRequest('/api/admin/students')
      .then((result) => { if (active) setStudents(result.students || []) })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])

  async function toggleActive(student) {
    try {
      const result = await apiRequest(`/api/admin/students/${encodeURIComponent(student.email)}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !student.active }),
      })
      setStudents((current) => current.map((item) => item.email === student.email ? { ...item, active: result.active } : item))
      onNotify(result.active ? 'Student account reactivated.' : 'Student access deactivated and sessions revoked.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">LEARNER MANAGEMENT</p><h1>Students</h1><p className="page-description">Review accounts, active subscriptions, course activity, and deactivate access when needed.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {students.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr><th>STUDENT</th><th>JOINED</th><th>ACTIVE SUBSCRIPTIONS</th><th>LESSONS COMPLETED</th><th>QUIZ/TEST ATTEMPTS</th><th>ACCOUNT</th><th></th></tr></thead>
      <tbody>{students.map((student) => <tr key={student.email}><td><strong>{student.name}</strong><small>{student.email}{student.phone ? ` · ${student.phone}` : ''}</small></td><td>{new Date(student.createdAt).toLocaleDateString()}</td><td>{student.activeSubscriptions}</td><td>{student.completedLessons}</td><td>{student.assessmentAttempts}</td><td>{student.active ? 'Active' : 'Disabled'}</td><td><button className="button button-outline" type="button" onClick={() => toggleActive(student)}>{student.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}</tbody>
    </table></div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Users size={21} /></div><h3>No student accounts</h3><p>Registered learners will appear here with their course status and learning activity.</p></div></div>}
  </>
}

export function TeacherHome({ courses, permissions, onOpen }) {
  return <>
    <header className="page-heading"><div><p className="eyebrow">INSTRUCTOR WORKSPACE</p><h1>Your teaching space</h1><p className="page-description">This dashboard shows only courses assigned to you. Each available action follows permissions set by the owner.</p></div></header>
    <div className="stat-strip"><div className="stat-item"><div className="stat-icon"><BookOpen size={17} /></div><div><span>Assigned courses</span><strong>{courses.length}</strong></div></div><div className="stat-item"><div className="stat-icon"><Check size={17} /></div><div><span>Granted permissions</span><strong>{Object.values(permissions || {}).filter(Boolean).length}</strong></div></div></div>
    {courses.length ? <div className="course-grid">{courses.map((course) => <article className="course-card" key={course.id}><div className="course-card-art"><BookOpen size={34} /></div><div className="course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>{course.description}</p><button className="text-action" type="button" onClick={() => onOpen(course.id)}>Open assigned course <ArrowRight size={14} /></button></div></article>)}</div> : <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><BookOpen size={21} /></div><h3>No course assignments</h3><p>Ask the owner to assign a course before you start teaching.</p></div></div>}
  </>
}
