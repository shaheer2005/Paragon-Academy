import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Award, Bell, BookOpen, Check, ClipboardList, Clock3, CreditCard, FileText, MessageCircle, MessageSquareText, Plus, Sparkles, Trophy, Video } from 'lucide-react'

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const result = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result
}

function useRemoteList(path, key) {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!path) return undefined
    let active = true
    request(path).then((result) => {
      if (active) setItems(result[key] || [])
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    })
    return () => { active = false }
  }, [path, key])
  return { items, setItems, error }
}

export function AssessmentsPage({ role, courses, onNotify, onUnlockCourse }) {
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((item) => item.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [assessments, setAssessments] = useState([])
  const [error, setError] = useState('')
  const [activeAttempt, setActiveAttempt] = useState(null)
  const [attemptResult, setAttemptResult] = useState(null)
  const [questions, setQuestions] = useState([{ prompt: '', options: ['', ''], correctIndex: 0 }])
  const course = courses.find((item) => item.id === courseId)
  const canCreateQuiz = role === 'admin' || Boolean(course?.permissions?.createQuizzes)
  const canCreateTest = role === 'admin' || Boolean(course?.permissions?.createTests)
  const [kind, setKind] = useState(canCreateQuiz ? 'quiz' : 'test')
  const selectedKind = kind === 'quiz' ? (canCreateQuiz ? 'quiz' : 'test') : (canCreateTest ? 'test' : 'quiz')
  const [remainingSeconds, setRemainingSeconds] = useState(null)

  useEffect(() => {
    if (!activeAttempt?.durationMinutes) return undefined
    const deadline = new Date(activeAttempt.startedAt).getTime() + activeAttempt.durationMinutes * 60 * 1000
    let submitted = false
    let timer
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemainingSeconds(remaining)
      if (remaining === 0 && !submitted) {
        submitted = true
        window.clearInterval(timer)
        request(`/api/assessment-attempts/${encodeURIComponent(activeAttempt.attemptId)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: activeAttempt.answers }),
        }).then((result) => {
          setAttemptResult({ ...result, questions: activeAttempt.questions, title: activeAttempt.title })
          setActiveAttempt(null)
          return request(`/api/courses/${encodeURIComponent(courseId)}/assessments`)
        }).then((result) => setAssessments(result.assessments || []))
          .catch((requestError) => setError(requestError.message))
      }
    }
    timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [activeAttempt, courseId])

  async function loadAssessments() {
    if (!courseId) return
    try {
      const result = await request(`/api/courses/${encodeURIComponent(courseId)}/assessments`)
      setAssessments(result.assessments || [])
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  useEffect(() => {
    let active = true
    if (!courseId) return undefined
    request(`/api/courses/${encodeURIComponent(courseId)}/assessments`)
      .then((result) => { if (active) setAssessments(result.assessments || []) })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])

  function updateQuestion(index, change) {
    setQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? { ...question, ...change } : question))
  }

  async function createAssessment(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const payload = {
      title: String(form.get('title')).trim(),
      kind: String(form.get('kind')),
      chapterId: String(form.get('chapterId') || '') || null,
      durationMinutes: Number(form.get('durationMinutes') || 0),
      randomize: form.get('randomize') === 'on',
      isFree: form.get('isFree') === 'on',
      questions: questions.map((question) => ({ ...question, prompt: question.prompt.trim(), options: question.options.map((option) => option.trim()) })),
    }
    try {
      await request(`/api/courses/${encodeURIComponent(courseId)}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      formElement.reset()
      setQuestions([{ prompt: '', options: ['', ''], correctIndex: 0 }])
      await loadAssessments()
      onNotify('Draft assessment saved.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function publishAssessment(assessment, published) {
    try {
      await request(`/api/assessments/${encodeURIComponent(assessment.id)}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published }),
      })
      await loadAssessments()
      onNotify(published ? 'Assessment published and students notified.' : 'Assessment unpublished.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function startAttempt(assessment) {
    try {
      const result = await request(`/api/assessments/${encodeURIComponent(assessment.id)}/attempts`, { method: 'POST' })
      setAttemptResult(null)
      setActiveAttempt({ ...result, title: assessment.title, answers: {} })
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function submitAttempt() {
    if (!activeAttempt) return
    try {
      const result = await request(`/api/assessment-attempts/${encodeURIComponent(activeAttempt.attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: activeAttempt.answers }),
      })
      setAttemptResult({ ...result, questions: activeAttempt.questions, title: activeAttempt.title })
      setActiveAttempt(null)
      await loadAssessments()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">ASSESSMENT CENTER</p><h1>Quizzes & tests</h1><p className="page-description">Chapter quizzes and full-course tests with automatic scoring, time limits, attempt history, and randomized question/option order.</p></div><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {role !== 'student' && course && (canCreateQuiz || canCreateTest) && <form className="panel assessment-create" onSubmit={createAssessment}>
      <h2><Plus size={17} />Create assessment</h2>
      <div className="assessment-form-grid">
        <label className="form-field"><span>Title</span><input name="title" required maxLength="180" /></label>
        <label className="form-field"><span>Type</span><select name="kind" value={selectedKind} onChange={(event) => setKind(event.target.value)}>{canCreateQuiz && <option value="quiz">Quiz</option>}{canCreateTest && <option value="test">Test</option>}</select></label>
        <label className="form-field"><span>Chapter (optional)</span><select name="chapterId"><option value="">Full course</option>{course.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}</select></label>
        <label className="form-field"><span>Time limit (minutes; 0 = untimed)</span><input name="durationMinutes" type="number" min="0" max="360" defaultValue="0" /></label>
      </div>
      <label className="permission-toggle"><input name="randomize" type="checkbox" />Randomize questions and answer options per attempt</label>
      <label className="permission-toggle"><input name="isFree" type="checkbox" />Offer this quiz or test for free (students can take it without buying the course)</label>
      {questions.map((question, index) => <fieldset className="assessment-question-editor" key={index}>
        <legend>Question {index + 1}</legend>
        <input aria-label={`Question ${index + 1} prompt`} value={question.prompt} maxLength="1000" onChange={(event) => updateQuestion(index, { prompt: event.target.value })} placeholder="Question text" required />
        <div className="assessment-options">{question.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`correct-${index}`} checked={question.correctIndex === optionIndex} onChange={() => updateQuestion(index, { correctIndex: optionIndex })} aria-label={`Mark option ${optionIndex + 1} correct`} /><input value={option} maxLength="300" onChange={(event) => updateQuestion(index, { options: question.options.map((value, currentIndex) => currentIndex === optionIndex ? event.target.value : value) })} placeholder={`Option ${optionIndex + 1}`} required /></label>)}</div>
        <div className="assessment-question-actions"><button className="button button-outline" type="button" disabled={question.options.length >= 8} onClick={() => updateQuestion(index, { options: [...question.options, ''] })}>Add option</button>{questions.length > 1 && <button className="button button-outline" type="button" onClick={() => setQuestions((current) => current.filter((_, currentIndex) => currentIndex !== index))}>Remove question</button>}</div>
      </fieldset>)}
      <div className="assessment-question-actions"><button className="button button-outline" type="button" disabled={questions.length >= 200} onClick={() => setQuestions((current) => [...current, { prompt: '', options: ['', ''], correctIndex: 0 }])}>Add question</button><button className="button button-primary">Save draft <ArrowRight size={14} /></button></div>
    </form>}
    {activeAttempt && <section className="panel active-assessment"><header><div><p className="eyebrow">IN PROGRESS</p><h2>{activeAttempt.title}</h2></div><span><Clock3 size={15} />{activeAttempt.durationMinutes ? `${Math.floor((remainingSeconds ?? activeAttempt.durationMinutes * 60) / 60)}:${String((remainingSeconds ?? activeAttempt.durationMinutes * 60) % 60).padStart(2, '0')} remaining` : 'Untimed'}</span></header>{activeAttempt.questions.map((question, questionIndex) => <fieldset className="attempt-question" key={question.id}><legend>{questionIndex + 1}. {question.prompt}</legend>{question.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={question.id} checked={activeAttempt.answers[question.id] === optionIndex} onChange={() => setActiveAttempt((current) => ({ ...current, answers: { ...current.answers, [question.id]: optionIndex } }))} />{option}</label>)}</fieldset>)}<button className="button button-primary" type="button" onClick={submitAttempt}>Submit assessment <Check size={15} /></button></section>}
    {attemptResult && <section className="panel assessment-result"><p className="eyebrow">RESULT</p><h2>{attemptResult.title}</h2><strong>{attemptResult.score} / {attemptResult.total} · {attemptResult.percentage}%</strong><p>Correct answers are shown below to support immediate learning.</p>{attemptResult.questions.map((question, index) => { const review = attemptResult.review.find((item) => item.questionId === question.id); return <div className="assessment-review" key={question.id}><strong>{index + 1}. {question.prompt}</strong><span>{review?.correct ? 'Correct' : `Incorrect · correct answer: ${question.options[review?.correctIndex]}`}</span></div> })}<button className="button button-outline" type="button" onClick={() => setAttemptResult(null)}>Close result</button></section>}
    {assessments.length ? <div className="feature-list">{assessments.map((assessment) => <article className="panel feature-card" key={assessment.id}><span className="feature-icon"><FileText size={17} /></span><div><h3>{assessment.title}</h3><p>{assessment.kind} · {assessment.questionCount || assessment.questions.length} questions · {assessment.durationMinutes ? `${assessment.durationMinutes} min` : 'Untimed'} · {assessment.published ? 'Published' : 'Draft'}{assessment.isFree ? ' · Free' : ''}{assessment.locked ? ' · Locked until course purchase' : ''}</p>{role === 'student' && assessment.attempts?.length > 0 && <small>Attempts: {assessment.attempts.length} · best score {Math.max(...assessment.attempts.map((attempt) => attempt.percentage))}%</small>}</div>{role === 'student' ? (assessment.locked ? <button className="button button-outline" type="button" onClick={() => onUnlockCourse?.(course)}>Unlock course</button> : <button className="button button-primary" type="button" onClick={() => startAttempt(assessment)}>Start <ArrowRight size={14} /></button>) : <button className="button button-outline" type="button" onClick={() => publishAssessment(assessment, !assessment.published)}>{assessment.published ? 'Unpublish' : 'Publish'}</button>}</article>)}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><FileText size={21} /></div><h3>No assessments yet</h3><p>{role === 'student' ? 'Published course quizzes and tests will appear here, including free ones you can take before buying a course.' : 'Create the first quiz or test for this course.'}</p></div></div>}
  </>
}

export function AssignmentsPage({ role, courses, onNotify, onUnlockCourse }) {
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const course = courses.find((item) => item.id === courseId)
  const canManage = role === 'admin' || Boolean(course?.permissions?.manageAssignments)
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [chapterId, setChapterId] = useState('')
  const visibleAssignments = courseId ? assignments : []

  async function loadAssignments() {
    if (!courseId) {
      setAssignments([])
      return
    }
    try {
      const result = await request(`/api/courses/${encodeURIComponent(courseId)}/assignments`)
      setAssignments(result.assignments || [])
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  useEffect(() => {
    let active = true
    if (!courseId) return undefined
    request(`/api/courses/${encodeURIComponent(courseId)}/assignments`)
      .then((result) => { if (active) { setAssignments(result.assignments || []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])

  async function createAssignment(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    setSaving(true)
    try {
      await request(`/api/courses/${encodeURIComponent(courseId)}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(values.get('title')).trim(),
          instructions: String(values.get('instructions')).trim(),
          chapterId: chapterId || null,
          dueAt: values.get('dueAt') || null,
          points: Number(values.get('points')),
          isFree: values.get('isFree') === 'on',
        }),
      })
      formElement.reset()
      setChapterId('')
      await loadAssignments()
      onNotify('Assignment saved as a draft.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function publishAssignment(assignment, published) {
    try {
      await request(`/api/assignments/${encodeURIComponent(assignment.id)}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published }),
      })
      await loadAssignments()
      onNotify(published ? 'Assignment published and students notified.' : 'Assignment unpublished.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function submitAssignment(event, assignment) {
    event.preventDefault()
    const formElement = event.currentTarget
    const answer = String(new FormData(formElement).get('answer')).trim()
    setSaving(true)
    try {
      await request(`/api/assignments/${encodeURIComponent(assignment.id)}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      })
      await loadAssignments()
      onNotify('Assignment submitted for review.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function reviewSubmission(event, assignment, submission) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    try {
      const result = await request(`/api/assignments/${encodeURIComponent(assignment.id)}/submissions/${encodeURIComponent(submission.id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: Number(values.get('grade')), feedback: String(values.get('feedback')).trim() }),
      })
      setAssignments((current) => current.map((item) => item.id === assignment.id ? {
        ...item,
        submissions: item.submissions.map((row) => row.id === submission.id ? { ...row, ...result } : row),
      } : item))
      onNotify('Submission graded and student notified.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return <>
    <header className="page-heading">
      <div><p className="eyebrow">COURSEWORK</p><h1>Assignments</h1><p className="page-description">Publish coursework, submit written work, and review grades and feedback.</p></div>
      {courses.length > 1 && <label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!courseId && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><ClipboardList size={21} /></div><h3>No courses available</h3><p>Assignments appear when a course is assigned or subscribed to.</p></div></div>}
    {canManage && course && <form className="panel assignment-create" onSubmit={createAssignment}>
      <h2><Plus size={17} />Create assignment</h2>
      <label className="form-field"><span>Title</span><input name="title" required maxLength="180" /></label>
      <label className="form-field"><span>Instructions</span><textarea name="instructions" maxLength="10000" rows="4" placeholder="Describe the work students need to complete." /></label>
      <div className="assessment-form-grid">
        <label className="form-field"><span>Chapter</span><select value={chapterId} onChange={(event) => setChapterId(event.target.value)}><option value="">Entire course</option>{course.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}</select></label>
        <label className="form-field"><span>Due date (optional)</span><input name="dueAt" type="datetime-local" /></label>
        <label className="form-field"><span>Maximum points</span><input name="points" type="number" min="1" max="10000" defaultValue="100" required /></label>
      </div>
      <label className="permission-toggle"><input name="isFree" type="checkbox" />Offer this assignment for free (students can submit it without buying the course)</label>
      <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'} <ArrowRight size={14} /></button>
    </form>}
    {visibleAssignments.length ? <div className="assignment-list">{visibleAssignments.map((assignment) => (
      <article className="panel assignment-card" key={assignment.id}>
        <header><div><p className="eyebrow">{assignment.published ? 'PUBLISHED' : 'DRAFT'} · {assignment.points} POINTS{assignment.isFree ? ' · FREE' : ''}{assignment.locked ? ' · LOCKED' : ''}</p><h2>{assignment.title}</h2><p>{assignment.chapterId ? course?.chapters.find((chapter) => chapter.id === assignment.chapterId)?.title || 'Assigned chapter' : 'Full course'}{assignment.dueAt ? ` · Due ${new Date(assignment.dueAt).toLocaleString()}` : ''}</p></div>
          {canManage && <button className="button button-outline" type="button" onClick={() => publishAssignment(assignment, !assignment.published)}>{assignment.published ? 'Unpublish' : 'Publish'}</button>}
        </header>
        {assignment.instructions && <p className="assignment-instructions">{assignment.instructions}</p>}
        {role === 'student' && assignment.locked
          ? <div className="assignment-submitted"><p>This assignment is locked until you purchase the course.</p><button className="button button-primary" type="button" onClick={() => onUnlockCourse?.(course)}>Unlock course</button></div>
          : role === 'student' && assignment.submission?.grade !== null && assignment.submission?.grade !== undefined
          ? <div className="assignment-graded"><strong>Grade: {assignment.submission.grade} / {assignment.points}</strong><p>Your response: {assignment.submission.answer}</p>{assignment.submission.feedback && <blockquote>{assignment.submission.feedback}</blockquote>}</div>
          : role === 'student' && assignment.submission
            ? <p className="assignment-submitted">Submitted {new Date(assignment.submission.submittedAt).toLocaleString()}{assignment.submission.late ? ' · late' : ''} · awaiting review</p>
            : role === 'student'
              ? <form className="assignment-submit" onSubmit={(event) => submitAssignment(event, assignment)}><label className="form-field"><span>Your response</span><textarea name="answer" required maxLength="20000" rows="5" placeholder="Write your answer here." /></label><button className="button button-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit assignment'}</button></form>
              : canManage && assignment.submissions?.length > 0
                ? <div className="assignment-submissions"><h3>Submissions ({assignment.submissions.length})</h3>{assignment.submissions.map((submission) => <form className="assignment-review" key={submission.id} onSubmit={(event) => reviewSubmission(event, assignment, submission)}>
                  <div><strong>{submission.studentName || submission.studentEmail}</strong><small>{new Date(submission.submittedAt).toLocaleString()}</small><p>{submission.answer}</p></div>
                  <div className="assignment-review-fields"><label className="form-field"><span>Grade / {assignment.points}</span><input name="grade" type="number" min="0" max={assignment.points} step="0.5" defaultValue={submission.grade ?? ''} required /></label><label className="form-field"><span>Feedback</span><textarea name="feedback" maxLength="5000" defaultValue={submission.feedback} rows="2" /></label><button className="button button-outline">Save review</button></div>
                </form>)}</div>
                : canManage && assignment.published && <p className="assignment-submitted">No submissions yet.</p>}
      </article>
    ))}</div> : !error && courseId && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><ClipboardList size={21} /></div><h3>No assignments yet</h3><p>{role === 'student' ? 'Published assignments for this course will appear here.' : 'Create and publish an assignment for your students.'}</p></div></div>}
  </>
}

export function LiveClassesPage({ role, courses, onNotify }) {
  const [classes, setClasses] = useState([])
  const [attendanceHistory, setAttendanceHistory] = useState([])
  const [recordings, setRecordings] = useState([])
  const [recordingSelections, setRecordingSelections] = useState({})
  const [savingRecordingId, setSavingRecordingId] = useState('')
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [error, setError] = useState('')
  const [attendance, setAttendance] = useState(null)
  const selectedCourse = courses.find((course) => course.id === courseId)
  const canSchedule = role === 'admin' || Boolean(selectedCourse?.permissions?.scheduleLiveClasses)

  useEffect(() => {
    let active = true
    if (role === 'student') {
      Promise.all([
        request('/api/student/live-classes'),
        request('/api/student/attendance'),
        request('/api/student/live-class-recordings'),
      ]).then(([classesResult, attendanceResult, recordingsResult]) => {
        if (!active) return
        setClasses(classesResult.classes || [])
        setAttendanceHistory(attendanceResult.attendance || [])
        setRecordings(recordingsResult.recordings || [])
      }).catch((requestError) => { if (active) setError(requestError.message) })
      return () => { active = false }
    }
    if (role === 'admin') {
      request('/api/admin/live-classes').then((result) => { if (active) setClasses(result.classes || []) }).catch((requestError) => { if (active) setError(requestError.message) })
      return () => { active = false }
    }
    const visibleCourses = courses.filter((course) => course.permissions?.scheduleLiveClasses || course.permissions?.viewAttendance || course.permissions?.uploadVideos)
    Promise.all(visibleCourses.map((course) => request(`/api/teacher/courses/${encodeURIComponent(course.id)}/live-classes`)))
      .then((results) => { if (active) setClasses(results.flatMap((result) => result.classes || [])) })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [role, courses])

  async function schedule(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    const payload = { title: String(values.get('title')).trim(), startsAt: values.get('startsAt'), meetingUrl: String(values.get('meetingUrl')).trim(), chapterId: String(values.get('chapterId') || '') || null }
    try {
      const result = await request(`/api/courses/${encodeURIComponent(courseId)}/live-classes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      setClasses((current) => [...current, { ...result.liveClass, courseTitle: selectedCourse?.title }].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
      formElement.reset()
      onNotify('Live class scheduled; subscribed students were notified.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function join(liveClass) {
    try {
      await request(`/api/live-classes/${encodeURIComponent(liveClass.id)}/attendance`, { method: 'POST' })
      window.open(liveClass.meetingUrl, '_blank', 'noopener,noreferrer')
      onNotify('Attendance recorded. The meeting opens in a new tab.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function loadAttendance(liveClass) {
    try {
      const result = await request(`/api/live-classes/${encodeURIComponent(liveClass.id)}/attendance`)
      setAttendance({ title: liveClass.title, attendees: result.attendance || [] })
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function saveRecording(liveClass) {
    const contentId = recordingSelections[liveClass.id] ?? liveClass.recordingContentId ?? ''
    setSavingRecordingId(liveClass.id)
    try {
      const result = await request(`/api/live-classes/${encodeURIComponent(liveClass.id)}/recording`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId: contentId || null }),
      })
      setClasses((current) => current.map((item) => item.id === liveClass.id
        ? { ...item, recordingContentId: result.recordingContentId, recordingTitle: result.recordingTitle }
        : item))
      setRecordingSelections((current) => ({ ...current, [liveClass.id]: result.recordingContentId || '' }))
      onNotify(result.recordingContentId ? 'Class recording linked and subscribed students notified.' : 'Class recording removed.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSavingRecordingId('')
    }
  }

  async function remove(liveClass) {
    try {
      await request(`/api/admin/live-classes/${encodeURIComponent(liveClass.id)}`, { method: 'DELETE' })
      setClasses((current) => current.filter((item) => item.id !== liveClass.id))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">LIVE LEARNING</p><h1>Live classes</h1><p className="page-description">Schedule Zoom, Google Meet, or other meeting links, notify enrolled students, and track attendance.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {role !== 'student' && canSchedule && selectedCourse && <form className="panel live-schedule-form" onSubmit={schedule}>
      <h2><Plus size={17} />Schedule a class</h2>
      <div className="assessment-form-grid"><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
        <label className="form-field"><span>Chapter</span><select name="chapterId"><option value="">Course-wide</option>{selectedCourse.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}</select></label>
        <label className="form-field"><span>Class title</span><input name="title" required maxLength="180" /></label>
        <label className="form-field"><span>Date and time</span><input name="startsAt" type="datetime-local" required /></label>
        <label className="form-field"><span>Meeting URL</span><input name="meetingUrl" type="url" placeholder="https://meet.google.com/…" required /></label>
      </div><button className="button button-primary">Schedule live class <ArrowRight size={14} /></button>
    </form>}
    {role === 'teacher' && <label className="form-field feature-course-picker"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>}
    {classes.length ? <div className="feature-list">{classes.map((item) => {
      const itemCourse = courses.find((course) => course.id === item.courseId)
      const canManageRecording = role === 'admin' || Boolean(itemCourse?.permissions?.uploadVideos)
      const canViewThisAttendance = role === 'admin' || Boolean(itemCourse?.permissions?.viewAttendance)
      const lectures = itemCourse?.chapters
        .filter((chapter) => !item.chapterId || chapter.id === item.chapterId)
        .flatMap((chapter) => chapter.lectures.map((lecture) => ({ ...lecture, chapterTitle: chapter.title }))) || []
      return <article className="panel feature-card" key={item.id}>
        <span className="feature-icon"><Video size={17} /></span>
        <div><h3>{item.title}</h3><p>{item.courseTitle || itemCourse?.title} · {new Date(item.startsAt).toLocaleString()}</p>{item.chapterTitle && <small>{item.chapterTitle}</small>}{item.recordingTitle && <small>Recording: {item.recordingTitle}</small>}</div>
        {role === 'student'
          ? <button className="button button-primary" type="button" onClick={() => join(item)}>Join class <ArrowRight size={14} /></button>
          : <div className="feature-actions">{canViewThisAttendance && <button className="button button-outline" type="button" onClick={() => loadAttendance(item)}>Attendance</button>}{role === 'admin' && <button className="button button-outline" type="button" onClick={() => remove(item)}>Cancel class</button>}</div>}
        {role !== 'student' && canManageRecording && <form className="live-recording-form" onSubmit={(event) => { event.preventDefault(); void saveRecording(item) }}>
          <label className="form-field"><span>Class recording</span><select aria-label={`Recording for ${item.title}`} value={recordingSelections[item.id] ?? item.recordingContentId ?? ''} onChange={(event) => setRecordingSelections((current) => ({ ...current, [item.id]: event.target.value }))}>
            <option value="">No recording attached</option>{lectures.map((lecture) => <option value={lecture.id} key={lecture.id}>{lecture.chapterTitle} · {lecture.title}</option>)}
          </select></label>
          <button className="button button-outline" disabled={savingRecordingId === item.id || !lectures.length && !item.recordingContentId}>{savingRecordingId === item.id ? 'Saving…' : 'Save recording'}</button>
        </form>}
      </article>
    })}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Video size={21} /></div><h3>No upcoming live classes</h3><p>Scheduled classes for your courses will be listed here.</p></div></div>}
    {role === 'student' && <section className="attendance-history">
      <header className="attendance-panel-header"><div><p className="eyebrow">YOUR LEARNING RECORD</p><h2>Attendance history</h2></div></header>
      {attendanceHistory.length ? <div className="feature-list">{attendanceHistory.map((item) => <article className="panel feature-card" key={item.liveClassId}><span className="feature-icon"><Check size={17} /></span><div><h3>{item.title}</h3><p>{item.courseTitle} · {new Date(item.startsAt).toLocaleString()}</p>{item.chapterTitle && <small>{item.chapterTitle}</small>}</div><span className="attendance-history-status">Attended{item.markedAt ? ` · ${new Date(item.markedAt).toLocaleDateString()}` : ''}</span></article>)}</div> : !error && <div className="panel attendance-history-empty"><p>Your recorded class attendance will appear here.</p></div>}
    </section>}
    {role === 'student' && <section className="attendance-history">
      <header className="attendance-panel-header"><div><p className="eyebrow">MISSED A CLASS?</p><h2>Class recordings</h2></div></header>
      {recordings.length ? <div className="feature-list">{recordings.map((item) => <article className="panel live-recording-card" key={item.liveClassId}>
        <div><h3>{item.title}</h3><p>{item.courseTitle} · {new Date(item.startsAt).toLocaleString()}</p>{item.chapterTitle && <small>{item.chapterTitle}</small>}<strong>{item.recordingTitle}</strong></div>
        <video className="live-recording-player" controls controlsList="nodownload" disablePictureInPicture playsInline preload="none" aria-label={`Recording: ${item.title}`} src={`/api/content/${encodeURIComponent(item.recordingContentId)}/stream`} />
      </article>)}</div> : !error && <div className="panel attendance-history-empty"><p>Recordings of past classes in your active courses will appear here.</p></div>}
    </section>}
    {attendance && <section className="panel attendance-panel"><header><h2>{attendance.title} · Attendance</h2><button type="button" className="button button-outline" onClick={() => setAttendance(null)}>Close</button></header>{attendance.attendees.length ? <div className="people-table-wrap"><table className="people-table"><thead><tr><th>STUDENT</th><th>ATTENDANCE</th><th>MARKED</th></tr></thead><tbody>{attendance.attendees.map((student) => <tr key={student.studentEmail}><td>{student.name}<small>{student.studentEmail}</small></td><td>{student.attended ? 'Attended' : 'Not marked'}</td><td>{student.markedAt ? new Date(student.markedAt).toLocaleString() : '—'}</td></tr>)}</tbody></table></div> : <p>No active course subscribers to report.</p>}</section>}
  </>
}

export function NotificationsPage({ role, courses, onNotify }) {
  const isStudent = role === 'student'
  const { items: notifications, setItems: setNotifications, error } = useRemoteList('/api/notifications', 'notifications')
  const [submitError, setSubmitError] = useState('')

  async function markRead(item) {
    try {
      await request(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' })
      setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, readAt: new Date().toISOString() } : notification))
    } catch (requestError) {
      setSubmitError(requestError.message)
    }
  }

  async function sendAnnouncement(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    const payload = { courseId: String(values.get('courseId') || '') || null, title: String(values.get('title')).trim(), body: String(values.get('body')).trim() }
    try {
      await request('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      formElement.reset()
      onNotify('Announcement sent to the applicable students.')
    } catch (requestError) {
      setSubmitError(requestError.message)
    }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">ANNOUNCEMENTS</p><h1>{isStudent ? 'Notifications' : 'Notifications & announcements'}</h1><p className="page-description">Important updates about courses, new learning materials, quizzes, tests, and upcoming live classes.</p></div></header>
    {submitError && <p className="form-error" role="alert">{submitError}</p>}
    {!isStudent && <form className="panel announcement-form" onSubmit={sendAnnouncement}><h2><Bell size={17} />Send an announcement</h2><label className="form-field"><span>Audience</span><select name="courseId">{role === 'admin' && <option value="">All students</option>}{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label><label className="form-field"><span>Title</span><input name="title" required maxLength="180" /></label><label className="form-field"><span>Message</span><textarea name="body" required maxLength="5000" /></label><button className="button button-primary">Send announcement <ArrowRight size={14} /></button></form>}
    {(error || !notifications.length) && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Bell size={21} /></div><h3>{error ? 'Notifications could not be loaded' : 'Your inbox is clear'}</h3><p>{error || 'Announcements, assignment activity, and private-message replies will appear here.'}</p></div></div>}
    {notifications.length > 0 && <div className="feature-list">{notifications.map((item) => <article className={`panel feature-card ${item.readAt ? '' : 'unread-notification'}`} key={item.id}><span className="feature-icon"><Bell size={17} /></span><div><h3>{item.title}</h3><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div>{!item.readAt && <button className="button button-outline" onClick={() => markRead(item)}>Mark read</button>}</article>)}</div>}
  </>
}

export function ProgressPage({ role, courses }) {
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const path = role === 'student' ? '/api/student/progress' : role === 'admin' ? '/api/admin/progress' : `/api/teacher/courses/${encodeURIComponent(courseId)}/progress`
  useEffect(() => {
    let active = true
    if (role === 'teacher' && !courseId) return undefined
    request(path).then((result) => { if (active) setRows(result.progress || []) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [path, role, courseId])
  return <>
    <header className="page-heading"><div><p className="eyebrow">LEARNING ANALYTICS</p><h1>Progress & results</h1><p className="page-description">Completed lessons, course completion, subscriptions, and assessment activity.</p></div>{role === 'teacher' && <label className="form-field"><span>Assigned course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr>{role !== 'student' && <th>STUDENT</th>}<th>COURSE</th><th>LESSONS COMPLETE</th><th>COURSE PROGRESS</th><th>ASSESSMENT ATTEMPTS</th>{role === 'student' && <th>AVERAGE SCORE</th>}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.courseId}-${row.email || 'self'}`}>{role !== 'student' && <td>{row.name}<small>{row.email}</small></td>}<td>{row.courseTitle}</td><td>{row.completedLessons} / {row.totalLessons}</td><td>{row.percentage}%</td><td>{row.assessmentAttempts ?? row.attempts}</td>{role === 'student' && <td>{row.averageScore}%</td>}</tr>)}</tbody></table></div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><BookOpen size={21} /></div><h3>No learning activity yet</h3><p>Active subscribed course progress and results appear here.</p></div></div>}
  </>
}

export function FeedbackManagementPage({ role, courses, onNotify }) {
  const { items: feedback, setItems: setFeedback, error } = useRemoteList('/api/feedback', 'feedback')
  const [rating, setRating] = useState(5)
  const [submitError, setSubmitError] = useState('')
  const [courseId, setCourseId] = useState(courses[0]?.id || '')
  const [contentId, setContentId] = useState('')
  const [teacherEmail, setTeacherEmail] = useState('')
  const { items: teachers } = useRemoteList(role === 'student' && courseId ? `/api/courses/${encodeURIComponent(courseId)}/teachers` : '', 'teachers')
  const course = courses.find((item) => item.id === courseId)
  const materials = useMemo(() => course?.chapters.flatMap((chapter) => [...chapter.lectures, ...chapter.materials]) || [], [course])
  const canRespond = role === 'admin' || role === 'teacher'

  async function submitFeedback(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    try {
      await request('/api/student/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, contentId: contentId || null, teacherEmail: teacherEmail || null, rating, comment: String(values.get('comment')).trim() }) })
      formElement.reset()
      onNotify('Feedback submitted.')
    } catch (requestError) {
      setSubmitError(requestError.message)
    }
  }

  async function reply(event, item) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    try {
      const result = await request(`/api/feedback/${encodeURIComponent(item.id)}/replies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: String(values.get('body')).trim() }) })
      setFeedback((current) => current.map((entry) => entry.id === item.id ? { ...entry, responses: [...(entry.responses || []), result.response] } : entry))
      formElement.reset()
      onNotify('Response sent to the student.')
    } catch (requestError) {
      setSubmitError(requestError.message)
    }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">STUDENT VOICE</p><h1>Feedback</h1><p className="page-description">Course, lecture, and teacher feedback with ratings and instructor responses.</p></div></header>
    {submitError && <p className="form-error" role="alert">{submitError}</p>}
    {role === 'student' && <form className="panel feedback-form" onSubmit={submitFeedback}><h2><MessageSquareText size={17} />Share course feedback</h2><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => { setCourseId(event.target.value); setContentId(''); setTeacherEmail('') }}>{courses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="form-field"><span>Lecture (optional)</span><select value={contentId} onChange={(event) => setContentId(event.target.value)}><option value="">Course-wide feedback</option>{materials.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label className="form-field"><span>Teacher (optional)</span><select value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)}><option value="">Course team</option>{teachers.map((teacher) => <option value={teacher.email} key={teacher.email}>{teacher.name}</option>)}</select></label><div className="rating-picker" aria-label="Course rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} stars`} className={rating >= value ? 'star-active' : ''} onClick={() => setRating(value)}>★</button>)}</div><label className="form-field"><span>Comment</span><textarea name="comment" maxLength="5000" /></label><button className="button button-primary">Send feedback <ArrowRight size={14} /></button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {feedback.length ? <div className="feature-list">{feedback.map((item) => <article className="panel feedback-card" key={item.id}><div><span className="feedback-rating">{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span><h3>{item.courseTitle}{item.contentTitle ? ` · ${item.contentTitle}` : ''}</h3><p>{item.comment || 'No written comment.'}</p><small>{item.studentName || item.studentEmail || 'Your feedback'} · {new Date(item.createdAt).toLocaleDateString()}</small></div>{item.responses?.map((response) => <blockquote key={response.id}>{response.body}<small>— {response.teacherEmail}</small></blockquote>)}{canRespond && <form className="feedback-reply" onSubmit={(event) => reply(event, item)}><input name="body" required maxLength="2000" placeholder="Write a response to the student" /><button className="button button-outline">Reply</button></form>}</article>)}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><MessageSquareText size={21} /></div><h3>No feedback yet</h3><p>Submitted feedback will appear here.</p></div></div>}
  </>
}

export function SubscriptionsPage({ role }) {
  const isStudent = role === 'student'
  const path = isStudent ? '/api/student/subscriptions' : '/api/admin/subscriptions'
  const { items: subscriptions, setItems: setSubscriptions, error } = useRemoteList(path, 'subscriptions')
  const [submitError, setSubmitError] = useState('')
  async function updateSubscription(subscription, action) {
    try {
      await request(`/api/admin/subscriptions/${encodeURIComponent(subscription.studentEmail)}/${encodeURIComponent(subscription.courseId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      setSubscriptions((current) => current.map((item) => item.studentEmail === subscription.studentEmail && item.courseId === subscription.courseId ? { ...item, status: action === 'renew' ? 'active' : 'cancelled' } : item))
    } catch (requestError) { setSubmitError(requestError.message) }
  }
  return <>
    <header className="page-heading"><div><p className="eyebrow">COURSE ACCESS</p><h1>Subscriptions</h1><p className="page-description">Course-level access periods and subscription expiry. Payment approval activates or extends the subscription.</p></div></header>
    {(error || submitError) && <p className="form-error" role="alert">{error || submitError}</p>}
    {subscriptions.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr>{!isStudent && <th>STUDENT</th>}<th>COURSE</th><th>STATUS</th><th>STARTS</th><th>EXPIRES</th><th>AMOUNT</th>{!isStudent && <th></th>}</tr></thead><tbody>{subscriptions.map((subscription) => <tr key={`${subscription.studentEmail || 'me'}-${subscription.courseId}`}>{!isStudent && <td>{subscription.studentName}<small>{subscription.studentEmail}</small></td>}<td>{subscription.courseTitle}</td><td>{subscription.status}</td><td>{new Date(subscription.startsAt).toLocaleDateString()}</td><td>{new Date(subscription.expiresAt).toLocaleDateString()}</td><td>{new Intl.NumberFormat('en-PK',{style:'currency',currency:'PKR',maximumFractionDigits:0}).format(subscription.amountPkr)}</td>{!isStudent && <td><button className="button button-outline" onClick={() => updateSubscription(subscription, subscription.status === 'active' ? 'cancel' : 'renew')}>{subscription.status === 'active' ? 'Cancel' : 'Renew'}</button></td>}</tr>)}</tbody></table></div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><CreditCard size={21} /></div><h3>No subscriptions</h3><p>Course subscription records appear here after payment review.</p></div></div>}
  </>
}

export function TeacherStudentsPage({ courses }) {
  const manageableCourses = courses.filter((course) => course.permissions?.manageStudents)
  const [requestedCourseId, setCourseId] = useState(manageableCourses[0]?.id || '')
  const courseId = manageableCourses.some((course) => course.id === requestedCourseId) ? requestedCourseId : manageableCourses[0]?.id || ''
  const [students, setStudents] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!courseId) return undefined
    let active = true
    request(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`)
      .then((result) => { if (active) { setStudents(result.students || []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])
  return <>
    <header className="page-heading"><div><p className="eyebrow">COURSE ROSTER</p><h1>Assigned students</h1><p className="page-description">View active subscribers and learning activity in courses the Owner assigned to you.</p></div><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{manageableCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {courseId && students.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr><th>STUDENT</th><th>PHONE</th><th>SUBSCRIPTION</th><th>EXPIRES</th><th>LESSONS COMPLETE</th></tr></thead><tbody>{students.map((student) => <tr key={student.email}><td>{student.name}<small>{student.email}</small></td><td>{student.phone || '—'}</td><td>{student.subscriptionStatus}</td><td>{student.expiresAt ? new Date(student.expiresAt).toLocaleDateString() : '—'}</td><td>{student.completedLessons}</td></tr>)}</tbody></table></div> : courseId && !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><BookOpen size={21} /></div><h3>No active students</h3><p>Current subscribers for this assigned course will appear here.</p></div></div>}
  </>
}

export function TeacherPaymentsPage({ courses }) {
  const manageableCourses = courses.filter((course) => course.permissions?.managePayments)
  const [requestedCourseId, setCourseId] = useState(manageableCourses[0]?.id || '')
  const courseId = manageableCourses.some((course) => course.id === requestedCourseId) ? requestedCourseId : manageableCourses[0]?.id || ''
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!courseId) return undefined
    let active = true
    request(`/api/teacher/courses/${encodeURIComponent(courseId)}/payments`)
      .then((result) => { if (active) { setPayments(result.payments || []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])
  return <>
    <header className="page-heading"><div><p className="eyebrow">COURSE PAYMENT STATUS</p><h1>Assigned-course payments</h1><p className="page-description">View payment review status for your assigned courses. Payment approval remains an Owner action.</p></div><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{manageableCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {courseId && payments.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr><th>STUDENT</th><th>TRANSFER REFERENCE</th><th>AMOUNT</th><th>STATUS</th><th>SUBMITTED</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.studentName}<small>{payment.studentEmail}</small></td><td>{payment.transferReference}</td><td>{new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(payment.amountPkr)}</td><td>{payment.status}</td><td>{new Date(payment.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : courseId && !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><CreditCard size={21} /></div><h3>No payment requests</h3><p>Course payment requests will appear here for review-status visibility.</p></div></div>}
  </>
}

export function AnalyticsPage() {
  const [analytics, setAnalytics] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    request('/api/admin/analytics').then((result) => { if (active) setAnalytics(result.analytics) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])
  const stats = analytics ? [
    ['Students', analytics.students],
    ['Active students', analytics.activeStudents],
    ['Teachers', analytics.teachers],
    ['Courses', analytics.courses],
    ['Published courses', analytics.publishedCourses],
    ['Active subscriptions', analytics.activeSubscriptions],
    ['Pending payments', analytics.pendingPayments],
    ['Approved revenue', new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(analytics.approvedRevenuePkr)],
    ['Assessment attempts', analytics.assessmentAttempts],
    ['Average assessment score', `${analytics.averageAssessmentScore}%`],
    ['Feedback submitted', analytics.feedbackCount],
    ['Average feedback rating', `${analytics.averageFeedbackRating} / 5`],
  ] : []
  return <>
    <header className="page-heading"><div><p className="eyebrow">OWNER REPORTS</p><h1>Platform analytics</h1><p className="page-description">Current platform-wide student, course, subscription, payment, assessment, and feedback measures.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {analytics && <div className="analytics-grid">{stats.map(([label, value]) => <div className="panel analytics-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
  </>
}

export function DiscussionsPage({ role, courses, onNotify }) {
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const course = courses.find((item) => item.id === courseId)
  const canModerate = role === 'admin' || Boolean(course?.permissions?.manageDiscussions)

  useEffect(() => {
    if (!courseId) return undefined
    let active = true
    request(`/api/courses/${encodeURIComponent(courseId)}/discussions`)
      .then((result) => { if (active) { setPosts(result.discussions || []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])

  async function reload() {
    const result = await request(`/api/courses/${encodeURIComponent(courseId)}/discussions`)
    setPosts(result.discussions || [])
  }

  async function addPost(event, parentId = null) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setSaving(true)
    try {
      await request(`/api/courses/${encodeURIComponent(courseId)}/discussions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, title: values.get('title'), body: values.get('body') }),
      })
      form.reset()
      await reload()
      onNotify(parentId ? 'Reply added.' : 'Discussion posted.')
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  async function setStatus(post) {
    try {
      await request(`/api/discussions/${encodeURIComponent(post.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: post.status === 'open' ? 'resolved' : 'open' }),
      })
      await reload()
    } catch (requestError) { setError(requestError.message) }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">COURSE COMMUNITY</p><h1>Discussions</h1><p className="page-description">Ask questions and share useful explanations with classmates and course staff.</p></div><label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {courseId && <form className="panel discussion-compose" onSubmit={(event) => addPost(event)}><h2><MessageCircle size={17} />Start a discussion</h2><label className="form-field"><span>Topic</span><input name="title" maxLength="180" required /></label><label className="form-field"><span>Message</span><textarea name="body" maxLength="5000" rows="3" required /></label><button className="button button-primary" disabled={saving}>Post discussion</button></form>}
    {posts.length ? <div className="discussion-list">{posts.map((post) => <article className="panel discussion-card" key={post.id}>
      <header><div><span className={`publish-badge ${post.status === 'open' ? 'is-published' : ''}`}>{post.status}</span><h2>{post.title}</h2><small>{post.authorName} · {new Date(post.createdAt).toLocaleString()}</small></div>{canModerate && <button className="button button-outline" type="button" onClick={() => setStatus(post)}>{post.status === 'open' ? 'Mark resolved' : 'Reopen'}</button>}</header>
      <p className="discussion-body">{post.body}</p>
      {post.replies.map((reply) => <div className="discussion-reply" key={reply.id}><strong>{reply.authorName}</strong><small>{new Date(reply.createdAt).toLocaleString()}</small><p>{reply.body}</p></div>)}
      {post.status === 'open' && <form className="discussion-reply-form" onSubmit={(event) => addPost(event, post.id)}><label className="form-field"><span>Reply</span><textarea name="body" maxLength="5000" rows="2" required /></label><button className="button button-outline" disabled={saving}>Reply</button></form>}
    </article>)}</div> : !error && courseId && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><MessageCircle size={21} /></div><h3>No discussions yet</h3><p>Start the course conversation with a question or helpful note.</p></div></div>}
  </>
}

export function QuestionsPage({ role, courses, onNotify }) {
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [questions, setQuestions] = useState([])
  const [error, setError] = useState('')
  const { items: teachers } = useRemoteList(role === 'student' && courseId ? `/api/student/courses/${encodeURIComponent(courseId)}/questions/teachers` : '', 'teachers')

  async function reload() {
    const result = await request('/api/questions')
    setQuestions(result.questions || [])
  }
  useEffect(() => {
    let active = true
    request('/api/questions').then((result) => { if (active) setQuestions(result.questions || []) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])

  async function createQuestion(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await request(`/api/student/courses/${encodeURIComponent(courseId)}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherEmail: values.get('teacherEmail'), subject: values.get('subject'), body: values.get('body') }),
      })
      form.reset()
      await reload()
      onNotify('Your private question was sent to the selected teacher.')
    } catch (requestError) { setError(requestError.message) }
  }

  async function reply(event, question) {
    event.preventDefault()
    const form = event.currentTarget
    const body = String(new FormData(form).get('body') || '').trim()
    try {
      await request(`/api/questions/${encodeURIComponent(question.id)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
      form.reset()
      await reload()
    } catch (requestError) { setError(requestError.message) }
  }

  async function closeQuestion(question) {
    try {
      await request(`/api/questions/${encodeURIComponent(question.id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: question.status === 'open' ? 'closed' : 'open' }) })
      await reload()
    } catch (requestError) { setError(requestError.message) }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">PRIVATE COURSE SUPPORT</p><h1>Questions & messages</h1><p className="page-description">Private course questions are visible only to the student and assigned teacher.</p></div>{role === 'student' && <label className="form-field"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {role === 'student' && courseId && <form className="panel discussion-compose" onSubmit={createQuestion}><h2><MessageSquareText size={17} />Ask a teacher privately</h2><label className="form-field"><span>Teacher</span><select name="teacherEmail" required><option value="">Choose an available teacher</option>{teachers.map((teacher) => <option value={teacher.email} key={teacher.email}>{teacher.name}</option>)}</select></label><label className="form-field"><span>Subject</span><input name="subject" maxLength="180" required /></label><label className="form-field"><span>Your question</span><textarea name="body" maxLength="5000" rows="3" required /></label><button className="button button-primary" disabled={!teachers.length}>Send private question</button>{!teachers.length && <small>There are no assigned teachers currently accepting private questions for this course.</small>}</form>}
    {questions.length ? <div className="discussion-list">{questions.map((question) => <article className="panel question-card" key={question.id}><header><div><p className="eyebrow">{question.courseTitle} · {question.status.toUpperCase()}</p><h2>{question.subject}</h2><small>{role === 'student' ? `To ${question.teacherEmail}` : `From ${question.studentEmail}`}</small></div><button className="button button-outline" type="button" onClick={() => closeQuestion(question)}>{question.status === 'open' ? 'Close question' : 'Reopen'}</button></header>
      <div className="question-messages">{question.messages.map((message) => <div className={`question-message ${message.senderEmail === (role === 'student' ? question.studentEmail : question.teacherEmail) ? 'question-message-own' : ''}`} key={message.id}><strong>{message.senderName}</strong><small>{new Date(message.createdAt).toLocaleString()}</small><p>{message.body}</p></div>)}</div>
      {question.status === 'open' && <form className="discussion-reply-form" onSubmit={(event) => reply(event, question)}><label className="form-field"><span>Reply privately</span><textarea name="body" maxLength="5000" rows="2" required /></label><button className="button button-outline">Send reply</button></form>}
    </article>)}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><MessageSquareText size={21} /></div><h3>No questions yet</h3><p>Private questions you start or receive will appear here.</p></div></div>}
  </>
}

export function StudentAchievementsPage({ courses, onNotify }) {
  const [certificates, setCertificates] = useState([])
  const [requestedCourseId, setCourseId] = useState(courses[0]?.id || '')
  const courseId = courses.some((course) => course.id === requestedCourseId) ? requestedCourseId : courses[0]?.id || ''
  const [leaderboard, setLeaderboard] = useState([])
  const [optedIn, setOptedIn] = useState(false)
  const [error, setError] = useState('')
  const [savingPreference, setSavingPreference] = useState(false)

  useEffect(() => {
    let active = true
    request('/api/student/certificates').then((result) => { if (active) setCertificates(result.certificates || []) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!courseId) return undefined
    let active = true
    request(`/api/student/courses/${encodeURIComponent(courseId)}/leaderboard`)
      .then((result) => { if (active) { setLeaderboard(result.leaderboard || []); setOptedIn(result.optedIn) } })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [courseId])

  async function updateOptIn(event) {
    const enabled = event.target.checked
    setSavingPreference(true)
    try {
      await request('/api/student/leaderboard-preference', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
      setOptedIn(enabled)
      const result = await request(`/api/student/courses/${encodeURIComponent(courseId)}/leaderboard`)
      setLeaderboard(result.leaderboard || [])
      onNotify(enabled ? 'Your first name and learning score are now visible on enrolled-course leaderboards.' : 'You have been removed from course leaderboards.')
    } catch (requestError) { setError(requestError.message); event.target.checked = optedIn } finally { setSavingPreference(false) }
  }

  async function issueCertificate(course) {
    try {
      await request(`/api/student/courses/${encodeURIComponent(course.courseId)}/certificate`, { method: 'POST' })
      const result = await request('/api/student/certificates')
      setCertificates(result.certificates || [])
      onNotify('Your course completion certificate is ready to verify.')
    } catch (requestError) { setError(requestError.message) }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">LEARNING MILESTONES</p><h1>Certificates & leaderboard</h1><p className="page-description">Earn a verifiable certificate after completing every course lesson and published assessment. Leaderboard participation is optional.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel achievement-panel"><header><div><p className="eyebrow">COURSE LEADERBOARD</p><h2>Recognition is up to you</h2></div><label className="leaderboard-consent"><input type="checkbox" checked={optedIn} disabled={savingPreference || !courseId} onChange={updateOptIn} /> Show my first name</label></header>
      <label className="form-field feature-course-picker"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      {optedIn ? leaderboard.length ? <ol className="leaderboard-list">{leaderboard.map((entry) => <li className={entry.self ? 'leaderboard-self' : ''} key={`${entry.rank}-${entry.name}`}><span><Trophy size={15} />#{entry.rank} {entry.name}{entry.self ? ' (you)' : ''}</span><strong>{entry.score}%</strong></li>)}</ol> : <p className="feature-empty">No learners have opted in for this course yet.</p> : <p className="feature-empty">Opt in to see rankings and share your first name and score. Your email and full results stay private.</p>}
      <small className="privacy-note">Score blends lesson completion and average assessment score (50% each when a course has published assessments).</small>
    </section>
    <section className="achievement-section"><header className="attendance-panel-header"><div><p className="eyebrow">YOUR COMPLETION RECORD</p><h2>Course certificates</h2></div></header>{certificates.length ? <div className="feature-list">{certificates.map((item) => <article className="panel feature-card" key={item.courseId}><span className="feature-icon"><Award size={17} /></span><div><h3>{item.courseTitle}</h3><p>{item.completeCount} of {item.lessonCount} lessons completed · {item.missedAssessments} assessments remaining</p>{item.certificate && <small>Issued {new Date(item.certificate.issuedAt).toLocaleDateString()} · Verification code: {item.certificate.verificationCode}</small>}</div>{item.certificate ? <a className="button button-outline" href={`/api/certificates/${encodeURIComponent(item.certificate.verificationCode)}/print`} target="_blank" rel="noreferrer">View certificate</a> : item.eligible ? <button className="button button-primary" type="button" onClick={() => issueCertificate(item)}>Issue certificate</button> : <span className="publish-badge">In progress</span>}</article>)}</div> : <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Award size={21} /></div><h3>No enrolled courses</h3><p>Course milestones and certificates appear after enrollment.</p></div></div>}</section>
  </>
}

export function TeacherPerformancePage() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    request('/api/admin/teacher-performance').then((result) => { if (active) setRows(result.performance || []) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])
  return <>
    <header className="page-heading"><div><p className="eyebrow">OWNER REPORTS</p><h1>Teacher performance</h1><p className="page-description">Course-scoped activity, learner outcomes, attendance, reviewed assignments, and student feedback.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length ? <div className="panel people-table-wrap"><table className="people-table"><thead><tr><th>TEACHER / COURSE</th><th>ACTIVE STUDENTS</th><th>LESSON COMPLETION</th><th>ASSESSMENTS</th><th>ATTENDANCE</th><th>ASSIGNMENTS REVIEWED</th><th>FEEDBACK</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.teacherEmail}-${row.courseId}`}><td>{row.teacherName}<small>{row.teacherEmail} · {row.courseTitle}</small></td><td>{row.activeStudents}</td><td>{row.lessonCompletionRate}%</td><td>{row.averageAssessmentScore}% average · {row.assessmentAttempts} attempts</td><td>{row.attendanceRate === null ? 'Not recorded' : `${row.attendanceRate}% (${row.attendanceMarked})`}</td><td>{row.assignmentsReviewed} / {row.assignmentSubmissions}</td><td>{row.averageFeedbackRating} / 5 · {row.feedbackCount} ratings</td></tr>)}</tbody></table></div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><Sparkles size={21} /></div><h3>No teacher course assignments</h3><p>Performance summaries will appear after teachers are assigned to courses.</p></div></div>}
  </>
}

export function CouponsPage({ courses, onNotify }) {
  const [coupons, setCoupons] = useState([])
  const [error, setError] = useState('')
  async function reload() {
    const result = await request('/api/admin/coupons')
    setCoupons(result.coupons || [])
  }
  useEffect(() => {
    let active = true
    request('/api/admin/coupons').then((result) => { if (active) setCoupons(result.coupons || []) }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [])
  async function create(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const payload = Object.fromEntries(values)
    payload.maxUses = payload.maxUses || null
    payload.courseId = payload.courseId || null
    payload.expiresAt = payload.expiresAt || null
    try {
      await request('/api/admin/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      form.reset()
      await reload()
      onNotify('Coupon created.')
    } catch (requestError) { setError(requestError.message) }
  }
  async function toggle(coupon) {
    try {
      await request(`/api/admin/coupons/${encodeURIComponent(coupon.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !coupon.active }) })
      await reload()
    } catch (requestError) { setError(requestError.message) }
  }
  return <>
    <header className="page-heading"><div><p className="eyebrow">COURSE PROMOTIONS</p><h1>Coupons</h1><p className="page-description">Create course-specific or platform-wide discounts. Redemptions are recorded only when a payment is approved.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="panel coupon-form" onSubmit={create}><h2><Sparkles size={17} />Create coupon</h2><div className="assessment-form-grid">
      <label className="form-field"><span>Code</span><input name="code" required minLength="3" maxLength="40" pattern="[A-Za-z0-9_-]+" /></label>
      <label className="form-field"><span>Discount type</span><select name="discountType"><option value="percent">Percent</option><option value="fixed">Fixed PKR</option></select></label>
      <label className="form-field"><span>Discount value</span><input name="discountValue" type="number" min="1" required /></label>
      <label className="form-field"><span>Maximum redemptions (optional)</span><input name="maxUses" type="number" min="1" /></label>
      <label className="form-field"><span>Expiry (optional)</span><input name="expiresAt" type="datetime-local" /></label>
      <label className="form-field"><span>Course scope</span><select name="courseId"><option value="">All courses</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label>
    </div><button className="button button-primary">Create coupon</button></form>
    {coupons.length ? <div className="feature-list">{coupons.map((coupon) => <article className="panel feature-card" key={coupon.id}><span className="feature-icon"><CreditCard size={17} /></span><div><h3>{coupon.code} · {coupon.discountType === 'percent' ? `${coupon.discountValue}%` : `PKR ${coupon.discountValue}`} off</h3><p>{coupon.courseTitle || 'All courses'} · {coupon.uses}{coupon.maxUses ? ` / ${coupon.maxUses}` : ''} redemptions{coupon.expiresAt ? ` · Expires ${new Date(coupon.expiresAt).toLocaleString()}` : ''}</p></div><span className={`publish-badge ${coupon.active ? 'is-published' : ''}`}>{coupon.active ? 'Active' : 'Inactive'}</span><button className="button button-outline" type="button" onClick={() => toggle(coupon)}>{coupon.active ? 'Deactivate' : 'Activate'}</button></article>)}</div> : !error && <div className="panel large-empty"><div className="empty-state"><div className="empty-icon"><CreditCard size={21} /></div><h3>No coupons created</h3><p>Set up your first discount code for students.</p></div></div>}
  </>
}
