import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CircleHelp,
  Clock3,
  CreditCard,
  FilePlus2,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareText,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react'
import './people.css'
import './commerce.css'
import './App.css'
import './experience.css'
import './media.css'

const AuthScreen = lazy(() => import('./AuthScreen.jsx'))

function lazyPage(loadModule, exportName) {
  return lazy(() => loadModule().then((module) => ({ default: module[exportName] })))
}

const loadPeoplePages = () => import('./PeoplePages.jsx')
const PeopleStudentsPage = lazyPage(loadPeoplePages, 'StudentsPage')
const TeacherHome = lazyPage(loadPeoplePages, 'TeacherHome')
const TeachersPage = lazyPage(loadPeoplePages, 'TeachersPage')

const loadFeaturePages = () => import('./FeaturePages.jsx')
const AnalyticsPage = lazyPage(loadFeaturePages, 'AnalyticsPage')
const AssessmentsPage = lazyPage(loadFeaturePages, 'AssessmentsPage')
const AssignmentsPage = lazyPage(loadFeaturePages, 'AssignmentsPage')
const CouponsPage = lazyPage(loadFeaturePages, 'CouponsPage')
const DiscussionsPage = lazyPage(loadFeaturePages, 'DiscussionsPage')
const FeedbackManagementPage = lazyPage(loadFeaturePages, 'FeedbackManagementPage')
const LiveClassesPage = lazyPage(loadFeaturePages, 'LiveClassesPage')
const NotificationsPage = lazyPage(loadFeaturePages, 'NotificationsPage')
const ProgressPage = lazyPage(loadFeaturePages, 'ProgressPage')
const QuestionsPage = lazyPage(loadFeaturePages, 'QuestionsPage')
const StudentAchievementsPage = lazyPage(loadFeaturePages, 'StudentAchievementsPage')
const SubscriptionsPage = lazyPage(loadFeaturePages, 'SubscriptionsPage')
const TeacherPerformancePage = lazyPage(loadFeaturePages, 'TeacherPerformancePage')
const TeacherPaymentsPage = lazyPage(loadFeaturePages, 'TeacherPaymentsPage')
const TeacherStudentsPage = lazyPage(loadFeaturePages, 'TeacherStudentsPage')
import './features.css'

function roleForPath(pathname) {
  if (pathname.startsWith('/admin') || pathname.startsWith('/owner')) return 'admin'
  if (pathname.startsWith('/teacher')) return 'teacher'
  return 'student'
}

const initialData = () => ({ courses: [], enrollments: [], payments: [] })

const studentLinks = [
  { id: 'home', label: 'Overview', icon: LayoutDashboard },
  { id: 'learning', label: 'My learning', icon: BookOpen },
  { id: 'explore', label: 'Explore courses', icon: Search },
  { id: 'materials', label: 'Study materials', icon: FileText },
  { id: 'assessments', label: 'Quizzes & tests', icon: Check },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'live-classes', label: 'Live classes', icon: Video },
  { id: 'progress', label: 'My progress', icon: Clock3 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareText },
  { id: 'discussions', label: 'Discussions', icon: MessageCircle },
  { id: 'questions', label: 'Ask a teacher', icon: MessageSquareText },
  { id: 'achievements', label: 'Certificates & rankings', icon: Award },
]

const teacherLinks = [
  { id: 'home', label: 'Teaching dashboard', icon: LayoutDashboard },
  { id: 'courses', label: 'Assigned courses', icon: BookOpen },
  { id: 'assessments', label: 'Quizzes & tests', icon: Check },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'live-classes', label: 'Live classes', icon: Video },
  { id: 'progress', label: 'Student progress', icon: Clock3 },
  { id: 'students', label: 'Assigned students', icon: Users },
  { id: 'payments', label: 'Course payments', icon: CreditCard },
  { id: 'notifications', label: 'Announcements', icon: Bell },
  { id: 'feedback', label: 'Course feedback', icon: MessageSquareText },
  { id: 'discussions', label: 'Course discussions', icon: MessageCircle },
  { id: 'questions', label: 'Student questions', icon: MessageSquareText },
]

const adminLinks = [
  { id: 'home', label: 'Overview', icon: LayoutDashboard },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'content', label: 'Content library', icon: FolderOpen },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'teachers', label: 'Teachers & access', icon: ShieldCheck },
  { id: 'assessments', label: 'Quizzes & tests', icon: Check },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'live-classes', label: 'Live classes', icon: Video },
  { id: 'notifications', label: 'Announcements', icon: Bell },
  { id: 'progress', label: 'Progress & results', icon: Clock3 },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareText },
  { id: 'analytics', label: 'Analytics', icon: LayoutDashboard },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'discussions', label: 'Course discussions', icon: MessageCircle },
  { id: 'questions', label: 'Student questions', icon: MessageSquareText },
  { id: 'teacher-performance', label: 'Teacher reports', icon: ShieldCheck },
  { id: 'coupons', label: 'Coupons', icon: CreditCard },
]

const pageNames = {
  home: 'Overview',
  learning: 'My learning',
  explore: 'Explore courses',
  materials: 'Study materials',
  assessments: 'Quizzes & tests',
  assignments: 'Assignments',
  'live-classes': 'Live classes',
  progress: 'Progress & results',
  notifications: 'Notifications',
  subscriptions: 'Subscriptions',
  analytics: 'Analytics',
  payments: 'Payments',
  feedback: 'Feedback',
  discussions: 'Discussions',
  questions: 'Questions & messages',
  achievements: 'Certificates & rankings',
  'teacher-performance': 'Teacher performance',
  coupons: 'Course coupons',
  courses: 'Courses',
  content: 'Content library',
  students: 'Students',
  teachers: 'Teachers & permissions',
  settings: 'Settings',
  course: 'Course workspace',
}

function formatPkr(amount) {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount || 0)
}

function formatStorage(bytes) {
  if (!bytes) return '0 GB'
  if (bytes < 1024 ** 2) return '<1 MB'
  const gigabytes = bytes / 1024 ** 3
  return gigabytes < 0.1 ? `${Math.ceil(bytes / 1024 ** 2)} MB` : `${gigabytes.toFixed(1)} GB`
}

function PublicLanding() {
  return <main className="public-home">
    <header className="public-home-nav">
      <a className="public-home-brand" href="/" aria-label="Paragon Academy home">
        <img src="/paragon-academy-logo.png" alt="" />
        <span>Paragon Academy</span>
      </a>
      <nav aria-label="Public navigation">
        <a className="public-home-signin" href="/signin">Sign in</a>
        <a className="button button-primary" href="/signup">Create student account <ArrowRight size={15} /></a>
      </nav>
    </header>

    <section className="public-home-hero">
      <div className="public-home-copy">
        <p className="eyebrow">LEARN WITH PURPOSE</p>
        <h1>Make room for<br />what’s next.</h1>
        <p className="public-home-intro">Explore thoughtfully organized courses, learn at your own pace, and keep your progress in one place.</p>
        <div className="public-home-actions">
          <a className="button button-primary" href="/signup">Get started <ArrowRight size={16} /></a>
          <a className="public-home-secondary" href="/signin">I already have an account</a>
        </div>
        <div className="public-home-trust"><ShieldCheck size={16} /> A learning space for students and teachers</div>
      </div>
      <div className="public-home-preview" aria-label="Learning dashboard preview">
        <div className="public-home-preview-head"><span><BookOpen size={17} /> Your learning space</span><span className="public-home-status">READY TO EXPLORE</span></div>
        <div className="public-home-preview-banner"><span className="public-home-preview-icon"><GraduationCap size={22} /></span><div><small>YOUR NEXT CHAPTER</small><strong>Learning starts here</strong><p>Find a course that moves you forward.</p></div></div>
        <div className="public-home-preview-stats"><div><span>01</span><small>Explore courses</small></div><div><span>02</span><small>Learn at your pace</small></div><div><span>03</span><small>Track your progress</small></div></div>
        <div className="public-home-preview-foot"><span className="public-home-progress"><i /></span><span>One step at a time</span></div>
      </div>
    </section>

    <section className="public-home-features" aria-label="Learning platform features">
      <article><span className="public-home-feature-icon"><BookOpen size={18} /></span><h2>Courses in one place</h2><p>Browse published courses and pick up learning whenever it works for you.</p></article>
      <article><span className="public-home-feature-icon"><Play size={18} /></span><h2>Learn step by step</h2><p>Follow course lessons, complete assessments, and see your progress grow.</p></article>
      <article><span className="public-home-feature-icon"><ShieldCheck size={18} /></span><h2>Support along the way</h2><p>Connect with teachers and keep your learning activity together.</p></article>
    </section>
    <footer className="public-home-footer"><span>© Paragon Academy</span><a href="/signin">Student and teacher sign in</a></footer>
  </main>
}

function IconButton({ children, label, onClick, className = '' }) {
  return <button className={`icon-button ${className}`} type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function EmptyState({ icon: Icon = BookOpen, title, description, action, actionLabel, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <div className="empty-icon"><Icon size={21} strokeWidth={1.7} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <button className="button button-primary" type="button" onClick={action}>{actionLabel}<ArrowRight size={15} /></button>}
    </div>
  )
}

function App() {
  const [data, setData] = useState(initialData)
  const [paymentOrders, setPaymentOrders] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [authSession, setAuthSession] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('lessonwell-session')) } catch { return null }
  })
  const [role, setRole] = useState(() => authSession?.role || roleForPath(window.location.pathname))
  const [page, setPage] = useState('home')
  const [activeCourseId, setActiveCourseId] = useState(null)
  const [activeLesson, setActiveLesson] = useState(null)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(500 * 1024 ** 3)
  const [defaultSubscriptionDays, setDefaultSubscriptionDays] = useState(365)

  useEffect(() => {
    if (authSession) sessionStorage.setItem('lessonwell-session', JSON.stringify(authSession))
    else sessionStorage.removeItem('lessonwell-session')
  }, [authSession])

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session expired.')
        return response.json()
      })
      .then(({ user }) => {
        if (!active) return
        setAuthSession((current) => ({ ...user, name: current?.name || user.name || user.email }))
        setRole(user.role)
      })
      .catch(() => { if (active) setAuthSession(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    function syncRoleRoute() {
      const routeRole = roleForPath(window.location.pathname)
      if (authSession && authSession.role !== routeRole) {
        const path = authSession.role === 'admin' ? '/admin' : authSession.role === 'teacher' ? '/teacher' : '/student'
        window.history.replaceState(null, '', path)
        setRole(authSession.role)
        return
      }
      setRole(routeRole)
    }
    window.addEventListener('popstate', syncRoleRoute)
    return () => window.removeEventListener('popstate', syncRoleRoute)
  }, [authSession])

  useEffect(() => {
    if (!authSession || role !== 'admin') return undefined
    let active = true
    fetch('/api/admin/storage', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result) {
          setStorageUsed(result.usedBytes)
          setStorageLimit(result.limitBytes)
        }
      })
      .catch((error) => { if (active) setToastMessage(error.message || 'Could not load storage usage.') })
    fetch('/api/admin/settings', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load platform defaults.')
        if (active && result.settings?.defaultSubscriptionDays) {
          setDefaultSubscriptionDays(Number(result.settings.defaultSubscriptionDays))
        }
      })
      .catch((error) => { if (active) setToastMessage(error.message || 'Could not load platform defaults.') })
    return () => { active = false }
  }, [authSession, role, data])

  useEffect(() => {
    if (!authSession) return undefined
    let active = true
    const endpoint = role === 'admin' ? '/api/admin/courses' : role === 'teacher' ? '/api/teacher/courses' : '/api/student/courses'
    fetch(endpoint, { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load courses.')
        if (active) setData((current) => ({ ...current, courses: result.courses }))
      })
      .catch((error) => { if (active) notify(error.message || 'Could not load courses.') })
    return () => { active = false }
  }, [authSession, role])

  useEffect(() => {
    if (!authSession || role !== 'student') return undefined
    let active = true
    fetch('/api/student/payments', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load payment orders.')
        if (active) setPaymentOrders(result.orders || [])
      })
      .catch(() => { if (active) setPaymentOrders([]) })
    return () => { active = false }
  }, [authSession, role])

  useEffect(() => {
    if (!authSession || role !== 'student') return undefined
    let active = true
    fetch('/api/payment-methods', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load payment methods.')
        if (active) setPaymentMethods(result.methods || [])
      })
      .catch((error) => { if (active) notify(error.message || 'Could not load payment methods.') })
    return () => { active = false }
  }, [authSession, role])

  useEffect(() => {
    if (!toastMessage) return undefined
    const timer = window.setTimeout(() => setToastMessage(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  const links = role === 'admin' ? adminLinks : role === 'teacher'
    ? teacherLinks.filter(({ id }) => id !== 'progress' || authSession.permissions?.viewStudentProgress)
      .filter(({ id }) => id !== 'live-classes' || authSession.permissions?.scheduleLiveClasses || authSession.permissions?.viewAttendance || authSession.permissions?.uploadVideos)
      .filter(({ id }) => id !== 'notifications' || authSession.permissions?.sendAnnouncements)
      .filter(({ id }) => id !== 'assignments' || authSession.permissions?.manageAssignments)
      .filter(({ id }) => id !== 'feedback' || authSession.permissions?.manageFeedback)
      .filter(({ id }) => id !== 'students' || authSession.permissions?.manageStudents)
      .filter(({ id }) => id !== 'payments' || authSession.permissions?.managePayments)
      .filter(({ id }) => id !== 'discussions' || authSession.permissions?.manageDiscussions)
      .filter(({ id }) => id !== 'questions' || authSession.permissions?.manageMessages)
    : studentLinks
  const activeCourse = data.courses.find((course) => course.id === activeCourseId)
  const filteredCourses = useMemo(() => data.courses.filter((course) => {
    const matchesQuery = `${course.title} ${course.category} ${course.subject || ''} ${course.classLevel || ''} ${course.description}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (role === 'admin' || course.published)
  }), [data.courses, query, role])
  const enrolledCourses = data.courses.filter((course) => course.purchased)

  function notify(message) {
    setToastMessage(message)
  }

  function goTo(nextPage) {
    setPage(nextPage)
    setActiveCourseId(null)
    setSidebarOpen(false)
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthSession(null)
    window.history.pushState(null, '', '/')
    goTo('home')
    setQuery('')
  }

  function signIn(user) {
    setAuthSession(user)
    setRole(user.role)
    window.history.pushState(null, '', user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/student')
    setPage('home')
  }

  async function addCourse(course) {
    try {
      const response = await fetch('/api/admin/courses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(course),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not create course.')
      setData((current) => ({ ...current, courses: [result.course, ...current.courses] }))
      setActiveCourseId(result.course.id)
      setPage('course')
      setModal(null)
      notify('Course created. Add its first chapter.')
    } catch (error) {
      notify(error.message || 'Could not create course.')
    }
  }

  function updateCourse(courseId, updater) {
    setData((current) => ({ ...current, courses: current.courses.map((course) => course.id === courseId ? updater(course) : course) }))
  }

  async function updateCourseDetails(courseId, changes) {
    try {
      const response = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update the course.')
      updateCourse(courseId, (course) => ({ ...course, ...result.course }))
      setModal(null)
      notify('Course details and subscription duration updated.')
    } catch (error) {
      notify(error.message || 'Could not update the course.')
    }
  }

  async function addChapter(courseId, chapter) {
    try {
      const response = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/chapters`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chapter),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not create chapter.')
      updateCourse(courseId, (course) => ({ ...course, chapters: [...course.chapters, result.chapter] }))
      setModal(null)
      notify('Chapter added to course.')
    } catch (error) {
      notify(error.message || 'Could not create chapter.')
    }
  }

  async function addContent(courseId, chapterId, content) {
    try {
      const form = new FormData()
      form.append('file', content.file)
      form.append('title', content.title)
      if (content.quality) form.append('quality', content.quality)
      if (content.duration) form.append('duration', content.duration)
      const endpoint = content.kind === 'lecture' ? 'lectures' : 'materials'
      const response = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Upload failed.')
      const savedContent = { ...result.content, format: content.format }
      updateCourse(courseId, (course) => ({
        ...course,
        chapters: course.chapters.map((chapter) => chapter.id !== chapterId ? chapter : content.kind === 'lecture'
          ? { ...chapter, lectures: [...chapter.lectures, savedContent] }
          : { ...chapter, materials: [...chapter.materials, savedContent] }),
      }))
      setModal(null)
      notify(content.kind === 'lecture' ? 'Lecture uploaded to private storage.' : 'Study material uploaded to private storage.')
    } catch (error) {
      notify(error.message || 'Upload failed. Check that the upload API is running.')
    }
  }

  async function updateContent(contentId, changes) {
    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(contentId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update content.')
      setData((current) => ({
        ...current,
        courses: current.courses.map((course) => ({
          ...course,
          chapters: course.chapters.map((chapter) => ({
            ...chapter,
            lectures: chapter.lectures.map((item) => item.id === contentId ? { ...item, ...result.content } : item),
            materials: chapter.materials.map((item) => item.id === contentId ? { ...item, ...result.content } : item),
          })),
        })),
      }))
      setModal(null)
      notify('Content title and PKR price updated.')
    } catch (error) {
      notify(error.message || 'Could not update content.')
    }
  }

  async function removeContent(content) {
    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(content.id)}`, { method: 'DELETE', credentials: 'include' })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Could not remove the file.')
      }
      setData((current) => ({
        ...current,
        courses: current.courses.map((course) => ({
          ...course,
          chapters: course.chapters.map((chapter) => ({
            ...chapter,
            lectures: chapter.lectures.filter((item) => item.id !== content.id),
            materials: chapter.materials.filter((item) => item.id !== content.id),
          })),
        })),
      }))
      setModal(null)
      notify('File and its private server copy were removed.')
    } catch (error) {
      notify(error.message || 'Could not remove the file.')
    }
  }

  async function openStudentContent(content) {
    try {
      const target = content?.type === 'course' ? { ...content, id: content.id, title: content.title, pricePkr: content.pricePkr || content.price || 0 } : content
      const accessPath = target.type === 'course'
        ? `/api/courses/${encodeURIComponent(target.id)}/access`
        : `/api/content/${encodeURIComponent(target.id)}/access`
      const response = await fetch(accessPath, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not check access.')
      if (!result.purchased) {
        const course = target.type === 'course'
          ? { ...target, id: target.id, price: target.pricePkr || target.price || 0 }
          : data.courses.find((item) => item.id === (target.courseId || result.courseId) || item.chapters.some((chapter) => chapter.id === target.chapterId)) || { id: target.courseId || activeCourse?.id, title: activeCourse?.title || 'Course', price: result.pricePkr || target.pricePkr || 0 }
        setModal({ type: 'purchase-content', course, content: course })
        return
      }
      const courseId = target.type === 'course' ? target.id : target.courseId || result.courseId
      updateCourse(courseId, (course) => ({ ...course, purchased: true }))
      if (target.type === 'course') {
        const course = data.courses.find((item) => item.id === target.id) || target
        setActiveCourseId(course.id)
        setPage('course')
      } else if (target.kind === 'lecture') {
        setActiveLesson(target)
        setPage('lesson')
      } else if (target.kind === 'material') {
        window.open(`/api/content/${encodeURIComponent(target.id)}/stream`, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      notify(error.message || 'Could not open this content.')
    }
  }

  async function reloadStudentPayments() {
    const response = await fetch('/api/student/payments', { credentials: 'include' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load payment orders.')
    setPaymentOrders(result.orders || [])
  }

  async function reloadCourses() {
    const endpoint = role === 'admin' ? '/api/admin/courses' : role === 'teacher' ? '/api/teacher/courses' : '/api/student/courses'
    const response = await fetch(endpoint, { credentials: 'include' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load courses.')
    setData((current) => ({ ...current, courses: result.courses }))
  }

  async function submitManualPayment(target, paymentDetails, receiptFile) {
    try {
      const courseId = (target?.type === 'course' || target?.chapters) ? target.id : target?.courseId
      if (!courseId) throw new Error('Choose a course before submitting payment.')
      const endpoint = `/api/student/courses/${encodeURIComponent(courseId)}/payments`
      const body = new FormData()
      for (const [key, value] of Object.entries(paymentDetails)) body.append(key, value)
      if (receiptFile?.size) body.append('receipt', receiptFile)
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        body,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Payment request failed.')
      setModal(null)
      await reloadStudentPayments()
      if (result.order?.status === 'approved') await reloadCourses()
      notify(result.message || 'Payment request sent for owner review.')
    } catch (error) {
      notify(error.message || 'Payment request failed.')
    }
  }

  async function deleteCourse(courseId) {
    try {
      const response = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        notify(result.error || 'Could not remove course media from the server.')
        return
      }
    } catch {
      notify('Could not reach the media API; course was not removed.')
      return
    }
    setData((current) => ({
      ...current,
      courses: current.courses.filter((course) => course.id !== courseId),
    }))
    setModal(null)
    setPage('courses')
    notify('Course and its local enrollment records were removed.')
  }

  async function togglePublished(course) {
    try {
      const response = await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}/publish`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !course.published }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update course publishing status.')
      updateCourse(course.id, (item) => ({ ...item, published: result.published }))
      notify(result.published ? 'Course published for students.' : 'Course moved to drafts.')
    } catch (error) {
      notify(error.message || 'Could not update course publishing status.')
    }
  }

  if (!authSession) {
    const pathname = window.location.pathname
    if (pathname === '/') return <PublicLanding />
    const adminOnly = pathname.startsWith('/admin') || pathname.startsWith('/owner')
    const authRole = adminOnly ? 'admin' : role
    return <Suspense fallback={<div className="page-loading" role="status">Loading sign in…</div>}>
      <AuthScreen
        key={`${authRole}-${adminOnly}-${pathname === '/signup'}`}
        initialRole={authRole}
        adminOnly={adminOnly}
        startWithSignup={pathname === '/signup'}
        onAuthenticated={signIn}
      />
    </Suspense>
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); goTo('home') }}>
             <img src="/paragon-academy-logo.png" alt="" />
             <span>Paragon Academy</span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-avatar">{role === 'admin' ? 'O' : role === 'teacher' ? 'T' : 'S'}</span>
          <span className="workspace-copy"><strong>{role === 'admin' ? 'Owner workspace' : role === 'teacher' ? 'Teaching space' : 'My classroom'}</strong><small>{role === 'admin' ? 'Owner / Super Admin' : role === 'teacher' ? 'Instructor' : 'Student account'}</small></span>
          <ChevronDown size={14} className="workspace-chevron" />
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <p className="nav-caption">{role === 'admin' ? 'MANAGE' : role === 'teacher' ? 'TEACH' : 'LEARN'}</p>
          {links.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`nav-link ${page === id || (id === 'courses' && page === 'course') ? 'nav-link-active' : ''}`} onClick={() => goTo(id)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {id === 'courses' && role === 'admin' && <span className="nav-count">{data.courses.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {role === 'admin' && <div className="storage-widget"><div className="storage-title"><span>Storage</span><span>{formatStorage(storageUsed)} / {formatStorage(storageLimit)}</span></div><div className="storage-bar"><span style={{ width: `${Math.min(100, storageLimit ? storageUsed / storageLimit * 100 : 0)}%` }} /></div><small>Configured capacity</small></div>}
          <button className="help-link" type="button" onClick={() => notify('Help center is not connected in this prototype.')}><CircleHelp size={16} /><span>Help center</span></button>
          <div className="sidebar-profile"><div className="profile-avatar">{role === 'admin' ? 'OW' : role === 'teacher' ? 'TE' : 'ST'}</div><div className="profile-name"><strong>{role === 'admin' ? 'Owner account' : role === 'teacher' ? 'Teacher account' : 'Student account'}</strong><small>{role === 'admin' ? 'Workspace owner' : role === 'teacher' ? 'Instructor profile' : 'Personal profile'}</small></div><IconButton label="Profile settings" onClick={() => goTo('settings')}><Settings2 size={16} /></IconButton></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><IconButton className="menu-button" label="Open navigation" onClick={() => setSidebarOpen((open) => !open)}><Menu size={18} /></IconButton><div className="breadcrumb">Workspace <ChevronRight size={13} /><strong>{pageNames[page] || 'Overview'}</strong></div></div>
          <div className="topbar-actions">
            <label className="search-field"><Search size={16} /><input aria-label="Search" placeholder={role === 'admin' ? 'Search workspace' : 'Search courses'} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <IconButton label="Notifications" onClick={() => goTo('notifications')}><Bell size={17} /></IconButton>
            <span className="account-chip"><span className="account-role-dot" />{authSession.name || authSession.role}</span>
            <IconButton label="Sign out" onClick={signOut}><LogOut size={16} /></IconButton>
          </div>
        </header>

        <div className="page-content">
          <Suspense fallback={<div className="page-loading" role="status">Loading page…</div>}>
          {page === 'home' && (role === 'admin'
            ? <AdminHome courses={data.courses} storageUsed={storageUsed} onCreate={() => setModal({ type: 'course' })} onNavigate={goTo} />
            : role === 'teacher'
              ? <TeacherHome courses={data.courses} permissions={authSession.permissions} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} />
              : <StudentHome enrolledCourses={enrolledCourses} onNavigate={goTo} />)}
          {page === 'courses' && (role === 'admin'
            ? <AdminCourses courses={filteredCourses} onCreate={() => setModal({ type: 'course' })} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} onRemove={(id) => setModal({ type: 'delete-course', courseId: id })} />
            : <TeacherHome courses={filteredCourses} permissions={authSession.permissions} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} />)}
          {page === 'course' && activeCourse && (role === 'admin'
            ? <CourseWorkspace course={activeCourse} onBack={() => goTo('courses')} onEditCourse={() => setModal({ type: 'edit-course', course: activeCourse })} onAddChapter={() => setModal({ type: 'chapter', courseId: activeCourse.id })} onAddContent={(chapterId, kind) => setModal({ type: 'content', courseId: activeCourse.id, chapterId, kind })} onEditContent={(content) => setModal({ type: 'edit-content', content })} onRemoveContent={(content) => setModal({ type: 'delete-content', content })} onPublish={() => togglePublished(activeCourse)} onNotify={notify} />
            : role === 'teacher'
              ? <CourseWorkspace course={activeCourse} teacher onBack={() => goTo('courses')}
                currentUserEmail={authSession.email}
                onAddContent={(chapterId, kind) => setModal({ type: 'content', courseId: activeCourse.id, chapterId, kind })}
                onEditContent={(content) => setModal({ type: 'edit-content', content })}
                onRemoveContent={(content) => setModal({ type: 'delete-content', content })}
                onNotify={notify} />
              : <StudentCoursePage course={activeCourse} onBack={() => goTo('explore')} onOpenContent={openStudentContent} onNotify={notify} />)}
                {page === 'lesson' && activeCourse && activeLesson && <LessonPage course={activeCourse} lesson={activeLesson} onBack={() => setPage('course')} onNotify={notify} />}
          {page === 'content' && <ContentLibrary courses={data.courses} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} onAdd={() => { const course = data.courses[0]; if (!course) setModal({ type: 'course' }); else if (!course.chapters.length) { setActiveCourseId(course.id); setPage('course') } else setModal({ type: 'content', courseId: course.id, chapterId: course.chapters[0].id, kind: 'lecture' }) }} />}
          {page === 'students' && (role === 'admin' ? <PeopleStudentsPage onNotify={notify} /> : <TeacherStudentsPage courses={data.courses} />)}
          {page === 'teachers' && <TeachersPage courses={data.courses} onNotify={notify} />}
          {page === 'settings' && <SettingsPage role={role} storageUsed={storageUsed} storageLimit={storageLimit} defaultSubscriptionDays={defaultSubscriptionDays} onSettingsSaved={(days) => setDefaultSubscriptionDays(days)} />}
          {page === 'explore' && <ExplorePage courses={filteredCourses} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} />}
          {page === 'learning' && <LearningPage courses={enrolledCourses} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} onExplore={() => goTo('explore')} />}
          {page === 'materials' && <MaterialsPage courses={role === 'student' ? filteredCourses : enrolledCourses} onOpen={(id) => { setActiveCourseId(id); setPage('course') }} />}
          {page === 'payments' && (role === 'admin' ? <AdminPaymentsPage role={role} onNotify={notify} /> : role === 'teacher' ? <TeacherPaymentsPage courses={data.courses} /> : <PaymentsPage payments={paymentOrders} courses={data.courses} />)}
          {page === 'assessments' && <AssessmentsPage role={role} courses={role === 'student' ? filteredCourses : data.courses} onNotify={notify} onUnlockCourse={(course) => openStudentContent({ ...course, type: 'course', pricePkr: course.price || course.pricePkr || 0 })} />}
          {page === 'assignments' && <AssignmentsPage role={role} courses={role === 'student' ? filteredCourses : role === 'teacher' ? data.courses.filter((course) => course.permissions?.manageAssignments) : data.courses} onNotify={notify} onUnlockCourse={(course) => openStudentContent({ ...course, type: 'course', pricePkr: course.price || course.pricePkr || 0 })} />}
          {page === 'live-classes' && <LiveClassesPage role={role} courses={role === 'student' ? enrolledCourses : role === 'teacher' ? data.courses.filter((course) => course.permissions?.scheduleLiveClasses || course.permissions?.viewAttendance || course.permissions?.uploadVideos) : data.courses} onNotify={notify} />}
          {page === 'notifications' && <NotificationsPage role={role} courses={role === 'teacher' ? data.courses.filter((course) => course.permissions?.sendAnnouncements) : data.courses} onNotify={notify} />}
          {page === 'progress' && <ProgressPage role={role} courses={role === 'student' ? enrolledCourses : role === 'teacher' ? data.courses.filter((course) => course.permissions?.viewStudentProgress) : data.courses} />}
          {page === 'subscriptions' && <SubscriptionsPage role={role} />}
          {page === 'analytics' && role === 'admin' && <AnalyticsPage />}
          {page === 'teacher-performance' && role === 'admin' && <TeacherPerformancePage />}
          {page === 'coupons' && role === 'admin' && <CouponsPage courses={data.courses} onNotify={notify} />}
          {page === 'feedback' && <FeedbackManagementPage role={role} courses={role === 'student' ? enrolledCourses : data.courses} onNotify={notify} />}
          {page === 'discussions' && <DiscussionsPage role={role} courses={role === 'student' ? enrolledCourses : role === 'teacher' ? data.courses.filter((course) => course.permissions?.manageDiscussions || course.permissions?.editCourses) : data.courses} onNotify={notify} />}
          {page === 'questions' && <QuestionsPage role={role} courses={role === 'student' ? enrolledCourses : role === 'teacher' ? data.courses.filter((course) => course.permissions?.manageMessages) : data.courses} onNotify={notify} />}
          {page === 'achievements' && role === 'student' && <StudentAchievementsPage courses={enrolledCourses} onNotify={notify} />}
          </Suspense>
        </div>
      </main>

      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      {modal && <Modal modal={modal} courses={data.courses} paymentMethods={paymentMethods} defaultSubscriptionDays={defaultSubscriptionDays} onClose={() => setModal(null)} onAddCourse={addCourse} onUpdateCourse={updateCourseDetails} onAddChapter={addChapter} onAddContent={addContent} onUpdateContent={updateContent} onRemoveContent={removeContent} onSubmitManualPayment={submitManualPayment} onDeleteCourse={deleteCourse} onNotify={notify} />}
      {toastMessage && <div className="toast" role="status"><Check size={16} />{toastMessage}</div>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>
}

function AdminHome({ courses, storageUsed, onCreate, onNavigate }) {
  const [analytics, setAnalytics] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/admin/analytics', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load workspace metrics.')
        if (active) setAnalytics(result.analytics)
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Could not load workspace metrics.') })
    return () => { active = false }
  }, [])
  const hasCourses = courses.length > 0
  return <>
    <PageHeading eyebrow="TEACHING WORKSPACE" title={hasCourses ? 'Your learning platform' : 'Build your classroom'} description={hasCourses ? 'Manage your courses, team, subscriptions, and learner outcomes.' : 'Your teaching space is ready. Add the first course whenever you are.'} />
    <section className="admin-welcome">
      <div className="welcome-copy"><div className="welcome-kicker"><span /> YOUR SPACE, YOUR WAY</div><h2>{hasCourses ? 'Teach, support, and grow.' : <>Start with one course.<br />Grow from there.</>}</h2><p>Organize lessons, share study materials, and give students a place to learn at their own pace.</p><button className="button button-dark" onClick={onCreate}>{hasCourses ? 'Create another course' : 'Create your first course'} <ArrowRight size={16} /></button></div>
      <div className="welcome-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="illustration-book"><BookOpen size={45} strokeWidth={1.2} /></div><div className="illustration-spark spark-one">✳</div><div className="illustration-spark spark-two">+</div><div className="illustration-note">A space to learn<br />something new</div></div>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="stat-strip"><Stat label="Courses" value={courses.length} icon={BookOpen} /><Stat label="Students" value={analytics?.students ?? '—'} icon={Users} /><Stat label="Active subscriptions" value={analytics?.activeSubscriptions ?? '—'} icon={CreditCard} /><Stat label="Storage used" value={formatStorage(storageUsed)} icon={FolderOpen} /></div>
    <div className="section-heading"><div><h2>Workspace reports</h2><p>{analytics ? `${analytics.pendingPayments} payment requests need review · ${analytics.assessmentAttempts} assessment attempts recorded` : 'Live platform metrics and learning activity'}</p></div><button className="subtle-link" onClick={() => onNavigate('analytics')}>View analytics <ArrowRight size={14} /></button></div>
    <div className="panel activity-panel"><EmptyState icon={Clock3} title={hasCourses ? 'Keep building your classroom' : 'Nothing here yet'} description={hasCourses ? 'Add course material, publish a quiz, or schedule a live class for your students.' : 'Your course updates and new enrollments will appear here.'} action={hasCourses ? () => onNavigate('courses') : onCreate} actionLabel={hasCourses ? 'Manage courses' : 'Add a course'} compact /></div>
  </>
}

function StudentHome({ enrolledCourses, onNavigate }) {
  const [progress, setProgress] = useState([])
  const [progressError, setProgressError] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/student/progress', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load learning progress.')
        if (active) {
          setProgress(result.progress || [])
          setProgressError('')
        }
      })
      .catch((error) => { if (active) setProgressError(error.message || 'Could not load learning progress.') })
    return () => { active = false }
  }, [])
  const completedLessons = progress.reduce((total, course) => total + course.completedLessons, 0)
  return <>
    <PageHeading eyebrow="YOUR LEARNING SPACE" title="A little room to grow" description="Your courses, learning progress, and notes will live here." />
    {progressError && <p className="form-error" role="alert">{progressError}</p>}
    <section className="student-welcome"><div className="student-welcome-copy"><span className="welcome-kicker"><span /> YOUR NEXT CHAPTER STARTS HERE</span><h2>There’s always something<br />worth learning.</h2><p>Find a course that sparks your curiosity and learn at your own pace.</p><button className="button button-dark" onClick={() => onNavigate('explore')}>Explore courses <ArrowRight size={16} /></button></div><div className="student-art" aria-hidden="true"><div className="student-art-window"><div className="window-sun" /><div className="window-line line-a" /><div className="window-line line-b" /><div className="window-leaf">✳</div></div><div className="art-caption">Make time<br />for your ideas</div></div></section>
    <div className="stat-strip student-stats"><Stat label="Courses enrolled" value={enrolledCourses.length} icon={BookOpen} /><Stat label="Lessons completed" value={completedLessons} icon={Check} /><Stat label="Assessment attempts" value={progress.reduce((total, course) => total + course.assessmentAttempts, 0)} icon={Clock3} /></div>
    <div className="section-heading"><div><h2>Your learning</h2><p>Pick up where you left off</p></div><button className="subtle-link" onClick={() => onNavigate('learning')}>My courses <ArrowRight size={14} /></button></div>
    {enrolledCourses.length ? <div className="course-grid">{enrolledCourses.slice(0, 3).map((course) => <CourseCard key={course.id} course={course} enrolled onClick={() => onNavigate('learning')} />)}</div> : <div className="panel learning-panel"><EmptyState icon={BookOpen} title="Your course list is empty" description="Once you enroll in a course, your lessons and progress will show up here." action={() => onNavigate('explore')} actionLabel="Find a course" compact /></div>}
  </>
}

function Stat({ label, value, icon: Icon }) {
  return <div className="stat-item"><div className="stat-icon"><Icon size={17} strokeWidth={1.8} /></div><div><span>{label}</span><strong>{value}</strong></div></div>
}

function AdminCourses({ courses, onCreate, onOpen, onRemove }) {
  return <>
    <PageHeading eyebrow="COURSE MANAGEMENT" title="Courses" description="Create courses and organize the learning experience." action={<button className="button button-primary" onClick={onCreate}><Plus size={16} />New course</button>} />
    {courses.length ? <div className="course-grid">{courses.map((course) => <CourseCard key={course.id} course={course} onClick={() => onOpen(course.id)} onRemove={() => onRemove(course.id)} admin />)}</div> : <div className="panel large-empty"><EmptyState icon={BookOpen} title="No courses have been added" description="Create a course to start adding chapters, recorded lectures, and study materials." action={onCreate} actionLabel="Create a course" /></div>}
  </>
}

function ExplorePage({ courses, onOpen }) {
  const available = courses.filter((course) => course.published)
  return <>
    <PageHeading eyebrow="COURSE CATALOG" title="Explore courses" description="Find a subject you’re curious about and learn from anywhere." />
    {available.length ? <div className="course-grid">{available.map((course) => <CourseCard key={course.id} course={course} onClick={() => onOpen(course.id)} />)}</div> : <div className="panel large-empty"><EmptyState icon={Search} title="The catalog is taking shape" description="There are no published courses just yet. Check back when your teaching team adds the first one." /></div>}
  </>
}

function LearningPage({ courses, onOpen, onExplore }) {
  return <>
    <PageHeading eyebrow="YOUR CLASSROOM" title="My learning" description="Your enrolled courses and learning progress." />
    {courses.length ? <div className="course-grid">{courses.map((course) => <CourseCard key={course.id} course={course} enrolled onClick={() => onOpen(course.id)} />)}</div> : <div className="panel large-empty"><EmptyState icon={BookOpen} title="Your learning list is empty" description="Enrolled courses will appear here, ready for you to continue whenever you like." action={onExplore} actionLabel="Browse courses" /></div>}
  </>
}

function CourseCard({ course, enrolled = false, admin = false, onClick, onRemove }) {
  const lessonCount = course.chapters.reduce((total, chapter) => total + chapter.lectures.length, 0)
  return <article className="course-card" onClick={onClick} onKeyDown={(event) => event.key === 'Enter' && onClick?.()} tabIndex={onClick ? 0 : undefined}>
    <div className={`course-card-art art-${(course.category || 'course').toLowerCase().replace(/[^a-z]/g, '')}`}><span className="course-category">{course.category || 'Course'}</span><BookOpen size={34} strokeWidth={1.25} /></div>
    <div className="course-card-body"><div className="course-card-top"><span>{admin ? 'Created by you' : course.instructor || 'Paragon Academy instructor'}</span><span className={`publish-badge ${course.published ? 'is-published' : ''}`}>{course.published ? 'Published' : 'Draft'}</span></div><h3>{course.title}</h3><p>{course.description || 'Course details will be added soon.'}</p><div className="course-card-meta"><span><BookOpen size={14} />{course.chapters.length} chapters</span><span><Video size={14} />{lessonCount} lessons</span><span><CreditCard size={13} />{course.price ? formatPkr(course.price) : 'Free'}</span></div><div className="course-card-footer">{admin ? <><button className="text-action" type="button" onClick={(event) => { event.stopPropagation(); onClick?.() }}>Manage course <ArrowRight size={14} /></button><button className="course-delete-button" type="button" aria-label={`Remove ${course.title}`} title="Remove course" onClick={(event) => { event.stopPropagation(); onRemove?.() }}><Trash2 size={15} /></button></> : enrolled ? <span className="enrolled-label"><Check size={14} /> Enrolled</span> : <button className="text-action" type="button" onClick={(event) => { event.stopPropagation(); onClick?.() }}>View course <ArrowRight size={14} /></button>}</div></div>
  </article>
}

function CourseWorkspace({ course, teacher = false, currentUserEmail = '', onBack, onEditCourse, onAddChapter, onAddContent, onEditContent, onRemoveContent, onPublish, onNotify }) {
  const [selectedLecture, setSelectedLecture] = useState(null)
  const permissions = course.permissions || {}
  const lessonCount = course.chapters.reduce((total, chapter) => total + chapter.lectures.length, 0)
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />All courses</button>
    <div className="course-workspace-head"><div><p className="eyebrow">{teacher ? 'ASSIGNED COURSE' : 'COURSE WORKSPACE'}</p><h1>{course.title}</h1><p className="page-description">{course.description || 'Add a course description to help students know what they will learn.'}</p></div><div className="course-head-actions"><span className={`publish-badge ${course.published ? 'is-published' : ''}`}>{course.published ? 'Published' : 'Draft'}</span>{!teacher && <button className="button button-primary" onClick={onPublish}>{course.published ? 'Unpublish' : 'Publish course'}<ArrowRight size={15} /></button>}</div></div>
    <div className="course-summary-strip"><span><BookOpen size={15} />{course.chapters.length} chapters</span><span><Video size={15} />{lessonCount} recorded lectures</span><span><FolderOpen size={15} />{course.chapters.reduce((total, item) => total + item.materials.length, 0)} materials</span><span><LockKeyhole size={15} />Downloads disabled</span></div>
    <div className="course-admin-layout"><section className="curriculum-column"><div className="section-heading"><div><h2>Course curriculum</h2><p>{teacher ? 'Work only within your assigned course and granted permissions.' : 'Arrange your course into clear chapters and topic groups.'}</p></div>{!teacher && <button className="button button-outline" onClick={onAddChapter}><Plus size={15} />Add chapter</button>}</div>
      {course.chapters.length ? <div className="chapter-list">{course.chapters.map((chapter, index) => <ChapterPanel key={chapter.id} courseId={course.id} chapter={chapter} index={index} teacher={teacher} currentUserEmail={currentUserEmail} permissions={permissions} onAddContent={onAddContent} onEditContent={onEditContent} onRemoveContent={onRemoveContent} onPlay={(lecture) => setSelectedLecture(lecture)} onNotify={onNotify} />)}</div> : <div className="panel chapter-empty"><EmptyState icon={FilePlus2} title={teacher ? 'No chapters assigned' : 'Start with a chapter'} description={teacher ? 'Ask the owner to assign a chapter or course.' : 'Chapters keep lectures and study materials organized for students.'} action={teacher ? undefined : onAddChapter} actionLabel="Add your first chapter" compact /></div>}
    </section><aside className="course-side-column"><div className="panel course-side-card"><h3>Course details</h3><DetailLine label="Category" value={course.category || 'Not set'} /><DetailLine label="Subject" value={course.subject || 'Not set'} /><DetailLine label="Class / grade" value={course.classLevel || 'Not set'} /><DetailLine label="Price" value={course.price ? formatPkr(course.price) : 'Free'} /><DetailLine label="Subscription duration" value={`${course.subscriptionDays || 365} days`} /><DetailLine label="Status" value={course.published ? 'Published' : 'Draft'} />{!teacher && <button className="side-action" onClick={onEditCourse}><Settings2 size={15} />Edit course details</button>}</div><div className="panel protection-card"><div className="protection-icon"><ShieldCheck size={18} /></div><div><strong>Protected content</strong><p>Students can stream videos and view notes. Direct downloads stay disabled.</p></div></div></aside></div>
    {selectedLecture && <VideoModal lecture={selectedLecture} onClose={() => setSelectedLecture(null)} />}
  </>
}

function StudentCoursePage({ course, onBack, onOpenContent }) {
  const lessonCount = course.chapters.reduce((total, chapter) => total + chapter.lectures.length, 0)
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />Course catalog</button>
    <div className="student-course-banner"><span className="course-category">{course.category}</span><BookOpen size={42} strokeWidth={1.2} /><div><p className="eyebrow">{[course.subject, course.classLevel].filter(Boolean).join(' · ') || 'COURSE DETAILS'}</p><h1>{course.title}</h1><p>{course.description}</p></div></div>
    <div className="student-course-layout"><section><div className="section-heading"><div><h2>Course content</h2><p>{course.chapters.length} chapters · {lessonCount} recorded lessons · full course access</p></div>{!course.purchased && <button className="button button-primary" onClick={() => onOpenContent({ ...course, id: course.id, pricePkr: course.price, kind: 'course', courseId: course.id, title: course.title, type: 'course' })}>Unlock course · {formatPkr(course.price || 0)}</button>}</div>
      {course.chapters.length ? <div className="chapter-list">{course.chapters.map((chapter, index) => <section className="chapter-panel" key={chapter.id}><div className="chapter-heading"><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-title"><strong>{chapter.title}</strong><small>{chapter.topic ? `${chapter.topic} · ` : ''}{chapter.lectures.length} videos · {chapter.materials.length} PDFs</small></span></div><div className="chapter-content">{chapter.lectures.map((lecture) => <button className="content-row student-content-row" key={lecture.id} onClick={() => onOpenContent({ ...lecture, kind: 'lecture', courseId: course.id, chapterId: chapter.id })}><span className="content-type-icon video-type"><Play size={13} fill="currentColor" /></span><span className="student-content-copy"><strong>{lecture.title}</strong><small>{lecture.quality || 'HD video'}</small></span><span className="content-lock-status"><LockKeyhole size={13} />{course.purchased ? 'Owned' : 'Locked'}</span></button>)}{chapter.materials.map((material) => <button className="content-row student-content-row" key={material.id} onClick={() => onOpenContent({ ...material, kind: 'material', courseId: course.id, chapterId: chapter.id })}><span className="content-type-icon file-type"><FileText size={15} /></span><span className="student-content-copy"><strong>{material.title}</strong><small>PDF</small></span><span className="content-lock-status"><LockKeyhole size={13} />{course.purchased ? 'Owned' : 'Locked'}</span></button>)}{!chapter.lectures.length && !chapter.materials.length && <p className="chapter-placeholder">Course content will be added soon.</p>}{!course.purchased && (chapter.lectures.length > 0 || chapter.materials.length > 0) && <p className="chapter-placeholder">Purchase this course to watch videos and open PDFs.</p>}</div></section>)}</div> : <div className="panel"><EmptyState icon={BookOpen} title="Course chapters are being prepared" description="The instructor will add chapters, lectures, and study materials here." compact /></div>}
    </section><aside className="panel student-course-info"><h3>About this course</h3><p>{course.description}</p><DetailLine label="Instructor" value={course.instructor || 'Course instructor'} /><DetailLine label="Lessons" value={`${lessonCount} / 90`} /><DetailLine label="Access" value={course.purchased ? 'Full course unlocked' : 'Buy the course to unlock all videos and PDFs'} /><div className="protected-caption"><LockKeyhole size={13} />{course.purchased ? 'Course access is active' : 'Course purchase unlocks all content in this course'}</div></aside></div>
  </>
}

function LessonPage({ course, lesson, onBack, onNotify }) {
  const [progress, setProgress] = useState(0)
  const lastSavedSecond = useRef(0)

  async function saveProgress(watchedSeconds, completed) {
    try {
      const response = await fetch(`/api/student/content/${encodeURIComponent(lesson.id)}/progress`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedSeconds, completed }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save lesson progress.')
    } catch (error) {
      onNotify(error.message || 'Could not save lesson progress.')
    }
  }

  function trackProgress(event) {
    const video = event.currentTarget
    const watchedSeconds = Math.floor(video.currentTime)
    setProgress(video.duration ? Math.round(video.currentTime / video.duration * 100) : 0)
    if (watchedSeconds - lastSavedSecond.current >= 15) {
      lastSavedSecond.current = watchedSeconds
      void saveProgress(watchedSeconds, false)
    }
  }

  function completeLesson(event) {
    const watchedSeconds = Math.floor(event.currentTarget.currentTime)
    lastSavedSecond.current = watchedSeconds
    void saveProgress(watchedSeconds, true)
    setProgress(100)
  }

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />Back to course</button>
    <div className="lesson-page-heading"><div><p className="eyebrow">{course.title}</p><h1>{lesson.title}</h1></div><span className="hd-badge"><ShieldCheck size={14} />HD video</span></div>
    <section className="lesson-player" aria-label="Video player">{lesson.id && <video className="uploaded-video" controls controlsList="nodownload" disablePictureInPicture playsInline preload="metadata" src={`/api/content/${encodeURIComponent(lesson.id)}/stream`} onTimeUpdate={trackProgress} onEnded={completeLesson} />}</section>
    <div className="lesson-progress-line"><span>Lesson progress</span><strong>{progress}%</strong><div className="capacity-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="lesson-below"><div><h2>Lesson resources</h2><p>Lecture progress is saved as you watch. Course access requires an active subscription.</p></div><span><LockKeyhole size={14} />Protected access</span></div>
  </>
}

function DetailLine({ label, value }) {
  return <div className="detail-line"><span>{label}</span><strong>{value}</strong></div>
}

function ChapterPanel({ courseId, chapter, index, teacher = false, currentUserEmail = '', permissions = {}, onAddContent, onEditContent, onRemoveContent, onPlay }) {
  const [open, setOpen] = useState(true)
  const canEdit = !teacher || permissions.editCourses
  const canAddVideo = !teacher || permissions.uploadVideos
  const canAddPdf = !teacher || permissions.uploadPdfs
  const canRemove = (item) => !teacher || (permissions.deleteContent && item.createdBy === currentUserEmail)
  return <section className="chapter-panel"><button className="chapter-heading" onClick={() => setOpen((value) => !value)}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-title"><strong>{chapter.title}</strong><small>{chapter.topic ? `${chapter.topic} · ` : ''}{chapter.lectures.length} videos · {chapter.materials.length} PDFs</small></span><ChevronDown className={open ? '' : 'chevron-closed'} size={17} /></button>
    {open && <div className="chapter-content">{chapter.lectures.map((lecture) => <div className="content-row" key={lecture.id}><button className="content-main" onClick={() => onPlay(lecture)}><span className="content-type-icon video-type"><Play size={13} fill="currentColor" /></span><span><strong>{lecture.title}</strong><small>{lecture.quality || 'HD 1080p'} · {lecture.duration || 'Duration not set'} · included with course</small></span></button>{canEdit && <button className="row-more" title="Edit title" onClick={() => onEditContent({ ...lecture, courseId, chapterId: chapter.id })} aria-label={`Edit ${lecture.title}`}>✎</button>}{canRemove(lecture) && <button className="course-delete-button" title="Remove video" onClick={() => onRemoveContent(lecture)} aria-label={`Remove ${lecture.title}`}><Trash2 size={14} /></button>}</div>)}
      {chapter.materials.map((material) => <div className="content-row" key={material.id}><button className="content-main" onClick={() => window.open(`/api/content/${encodeURIComponent(material.id)}/stream`, '_blank', 'noopener,noreferrer')}><span className="content-type-icon file-type"><FileText size={15} /></span><span><strong>{material.title}</strong><small>{material.fileName || 'PDF'} · included with course</small></span></button>{canEdit && <button className="row-more" title="Edit title" onClick={() => onEditContent({ ...material, courseId, chapterId: chapter.id })} aria-label={`Edit ${material.title}`}>✎</button>}{canRemove(material) && <button className="course-delete-button" title="Remove PDF" onClick={() => onRemoveContent(material)} aria-label={`Remove ${material.title}`}><Trash2 size={14} /></button>}</div>)}
      {!chapter.lectures.length && !chapter.materials.length && <p className="chapter-placeholder">No content in this chapter yet.</p>}
      {(canAddVideo || canAddPdf) && <div className="chapter-actions">{canAddVideo && <button onClick={() => onAddContent(chapter.id, 'lecture')}><Video size={14} />Add lecture</button>}{canAddPdf && <button onClick={() => onAddContent(chapter.id, 'material')}><FilePlus2 size={14} />Add study material</button>}</div>}
    </div>}
  </section>
}

function VideoModal({ lecture, onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal video-preview-modal" role="dialog" aria-modal="true" aria-label="Lecture preview"><div className="modal-header"><div><p className="eyebrow">LECTURE PREVIEW</p><h2>{lecture.title}</h2></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>{lecture.id ? <video className="admin-video-preview" controls controlsList="nodownload" disablePictureInPicture playsInline preload="metadata" src={`/api/content/${encodeURIComponent(lecture.id)}/stream`} /> : <div className="video-placeholder"><div><Play size={25} fill="currentColor" /><span>Video player preview</span><small>Upload a lecture file to preview it here.</small></div></div>}<div className="preview-controls"><span>{lecture.quality || 'HD 1080p'}</span><span>Downloads disabled</span><LockKeyhole size={15} /></div></section></div>
}

function ContentLibrary({ courses, onOpen, onAdd }) {
  const items = courses.flatMap((course) => course.chapters.flatMap((chapter) => [
    ...chapter.lectures.map((item) => ({ ...item, kind: 'Lecture', course, chapter })),
    ...chapter.materials.map((item) => ({ ...item, kind: 'Study material', course, chapter })),
  ]))
  return <>
    <PageHeading eyebrow="TEACHING MATERIALS" title="Content library" description="Your recorded lectures and learning materials, organized by course." action={<button className="button button-primary" onClick={onAdd}><Plus size={16} />Add content</button>} />
    <div className="content-callout"><ShieldCheck size={19} /><div><strong>Student access stays protected</strong><p>Lessons stream on the platform. Study materials open in the online viewer with downloads disabled.</p></div></div>
    {items.length ? <div className="panel content-table"><div className="content-table-head"><span>CONTENT</span><span>COURSE / CHAPTER</span><span>TYPE</span><span>ACCESS</span></div>{items.map((item) => <button className="content-table-row" key={item.id} onClick={() => onOpen(item.course.id)}><span className="content-cell-title">{item.kind === 'Lecture' ? <Video size={16} /> : <FileText size={16} />}<strong>{item.title}</strong></span><span>{item.course.title}<small>{item.chapter.title}</small></span><span>{item.kind}</span><span className="access-label"><LockKeyhole size={13} />Protected</span></button>)}</div> : <div className="panel large-empty"><EmptyState icon={FolderOpen} title="Your library is empty" description="Add a lecture or study material from a course chapter. Content will be listed here once added." action={onAdd} actionLabel="Add content" /></div>}
  </>
}

function AdminPaymentsPage({ role, onNotify }) {
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (role !== 'admin') return undefined
    let active = true
    async function loadOrders() {
      const response = await fetch('/api/admin/payments', { credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load payment reviews.')
      if (active) {
        setOrders(result.orders || [])
        setError('')
      }
    }
    loadOrders().catch((requestError) => { if (active) setError(requestError.message || 'Could not load payment reviews.') })
    const timer = window.setInterval(() => {
      loadOrders().catch(() => {})
    }, 8000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [role])

  async function updateOrder(orderId, action) {
    const response = await fetch(`/api/admin/payments/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not update payment order.')
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: result.status, reviewNote: result.reviewNote || order.reviewNote } : order))
    setError('')
    onNotify?.(result.status === 'approved' ? 'Payment approved. Course access is now active for the student.' : 'Payment rejected.')
  }

  return <>
    <PageHeading eyebrow="REVENUE REVIEW" title="Payment approvals" description="Check the submitted payment method and screenshot, then approve or reject course access." />
    {error && <p className="form-error" role="alert">{error}</p>}
    {orders.length ? <div className="panel payment-history payment-review-history"><div className="payment-history-heading"><span>STUDENT</span><span>CONTENT & METHOD</span><span>REFERENCE</span><span>AMOUNT</span><span>STATUS</span><span>ACTION</span></div>{orders.map((order) => <div className="payment-history-row" key={order.id}><strong>{order.studentEmail}</strong><span>{order.contentTitle}<small>{order.methodName || (order.couponCode ? 'Coupon redemption' : 'Legacy payment')}</small>{order.paymentDetails && <small>{order.paymentDetails}</small>}{order.receiptFile && <a className="receipt-link" href={`/api/admin/payments/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">View payment screenshot</a>}{order.couponCode && <small>Coupon {order.couponCode} · {formatPkr(order.discountPkr)} off</small>}</span><span>{order.transferReference || (order.couponCode ? 'Coupon redemption' : order.id)}</span><strong>{formatPkr(order.amountPkr)}{order.discountPkr > 0 && <small>from {formatPkr(order.baseAmountPkr)}</small>}</strong><span className="publish-badge">{order.status}</span><span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{order.status === 'pending' ? <><button className="button button-outline" type="button" onClick={() => updateOrder(order.id, 'approve').catch((updateError) => setError(updateError.message))}>Approve</button><button className="button button-outline" type="button" onClick={() => updateOrder(order.id, 'reject').catch((updateError) => setError(updateError.message))}>Reject</button></> : <small>No review needed</small>}</span></div>)} </div> : !error && <div className="panel large-empty"><EmptyState icon={CreditCard} title="No payment requests" description="Student payment submissions will appear here for review." /></div>}
  </>
}

function MaterialsPage({ courses, onOpen }) {
  const materials = courses.flatMap((course) => course.chapters.flatMap((chapter) => chapter.materials.map((material) => ({ ...material, course, chapter, locked: !course.purchased }))))
  return <>
    <PageHeading eyebrow="COURSE RESOURCES" title="Study materials" description="Browse study notes for published courses. Paid courses stay locked until your payment is approved." />
    {materials.length ? <div className="materials-list">{materials.map((item) => <button className="material-card" key={item.id} onClick={() => onOpen(item.course.id)}><span className="material-file-icon"><FileText size={19} /></span><span className="material-card-copy"><strong>{item.title}</strong><small>{item.course.title} · {item.chapter.title}</small></span><span className="view-online">{item.locked ? 'Locked until purchased' : 'View online'} <ArrowRight size={14} /></span><LockKeyhole size={15} className="material-lock" /></button>)}</div> : <div className="panel large-empty"><EmptyState icon={FileText} title="No study materials available" description="Notes and course resources will be listed here when the owner adds them to a published course." /></div>}
    <p className="privacy-note"><LockKeyhole size={14} />Course materials are available to view online. Downloading is disabled.</p>
  </>
}

function PaymentsPage({ payments, courses }) {
  const transactions = payments.map((payment) => ({ ...payment, course: courses.find((course) => course.id === payment.contentId || course.id === payment.courseId) }))
  return <>
    <PageHeading eyebrow="ACCOUNT" title="Payments" description="Your course payment requests, review status, and access history." />
    {transactions.length ? <div className="panel payment-history"><div className="payment-history-heading"><span>COURSE</span><span>REFERENCE</span><span>DATE</span><span>AMOUNT</span><span>STATUS</span></div>{transactions.map((payment) => <div className="payment-history-row" key={payment.id}><strong>{payment.course?.title || payment.contentTitle || 'Removed course'}{payment.methodName && <small>{payment.methodName}</small>}{payment.receiptFile && <small>Payment screenshot submitted</small>}{payment.reviewNote && <small>Review note: {payment.reviewNote}</small>}{payment.couponCode && <small>Coupon {payment.couponCode} · {formatPkr(payment.discountPkr)} saved</small>}</strong><span>{payment.transferReference || payment.id}{payment.paymentDetails && <small>{payment.paymentDetails}</small>}</span><span>{payment.createdAt ? new Date(payment.createdAt).toLocaleDateString('en-PK') : '—'}</span><strong>{formatPkr(payment.amountPkr || payment.amount)}</strong><span className="publish-badge">{payment.status || 'pending'}</span></div>)}<p className="payment-note">Course access is granted after an Owner verifies your payment and approves the request.</p></div> : <div className="panel large-empty"><EmptyState icon={CreditCard} title="No payment history" description="When you request access to a paid course, your payment method and review status will appear here." /></div>}
  </>
}

function SettingsPage({ role, storageUsed, storageLimit, defaultSubscriptionDays, onSettingsSaved }) {
  const [settings, setSettings] = useState({ platformName: 'Paragon Academy', supportEmail: '', defaultSubscriptionDays: String(defaultSubscriptionDays), paymentMethods: [] })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    if (role !== 'admin') return undefined
    let active = true
    fetch('/api/admin/settings', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load platform settings.')
        if (active) setSettings((current) => ({ ...current, ...result.settings, paymentMethods: result.settings.paymentMethods || [] }))
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Could not load platform settings.') })
    return () => { active = false }
  }, [role])

  async function saveSettings(event) {
    event.preventDefault()
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save platform settings.')
      setSettings((current) => ({ ...current, ...result.settings }))
      onSettingsSaved(Number(result.settings.defaultSubscriptionDays))
      setError('')
      setSaved('Platform and payment settings saved.')
    } catch (saveError) {
      setError(saveError.message || 'Could not save platform settings.')
      setSaved('')
    }
  }

  function addPaymentMethod() {
    const id = `method-${crypto.randomUUID().slice(0, 8)}`
    setSettings((current) => ({ ...current, paymentMethods: [...current.paymentMethods, { id, name: '', instructions: '', enabled: true }] }))
  }

  function updatePaymentMethod(id, changes) {
    setSettings((current) => ({ ...current, paymentMethods: current.paymentMethods.map((method) => method.id === id ? { ...method, ...changes } : method) }))
  }

  function removePaymentMethod(id) {
    setSettings((current) => ({ ...current, paymentMethods: current.paymentMethods.filter((method) => method.id !== id) }))
  }
  return <>
    <PageHeading eyebrow="WORKSPACE PREFERENCES" title="Settings" description="Manage content access and course platform preferences." />
    {role === 'admin' ? <div className="settings-layout"><form className="panel settings-panel" onSubmit={saveSettings}>
      <h2>Platform settings</h2><p>Configure the platform identity, subscription term, and manual payment options shown at checkout.</p>
      {error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="form-success" role="status">{saved}</p>}
      <label className="form-field"><span>Platform name</span><input value={settings.platformName} maxLength="160" onChange={(event) => setSettings((current) => ({ ...current, platformName: event.target.value }))} required /></label>
      <label className="form-field"><span>Support email</span><input type="email" value={settings.supportEmail} maxLength="160" onChange={(event) => setSettings((current) => ({ ...current, supportEmail: event.target.value }))} /></label>
      <label className="form-field"><span>Default subscription duration (days)</span><input type="number" min="1" max="3650" value={settings.defaultSubscriptionDays} onChange={(event) => setSettings((current) => ({ ...current, defaultSubscriptionDays: event.target.value }))} required /></label>
      <div className="payment-method-settings"><div><h3>Manual payment methods</h3><p>Tell students where to pay. They will submit the transaction reference and a screenshot for your review.</p></div>
        {settings.paymentMethods.map((method) => <div className="payment-method-editor" key={method.id}>
          <label className="form-field"><span>Method name</span><input value={method.name} maxLength="80" onChange={(event) => updatePaymentMethod(method.id, { name: event.target.value })} required /></label>
          <label className="form-field"><span>Payment instructions / account details</span><textarea value={method.instructions} maxLength="1000" onChange={(event) => updatePaymentMethod(method.id, { instructions: event.target.value })} required /></label>
          <div className="payment-method-actions"><label><input type="checkbox" checked={method.enabled} onChange={(event) => updatePaymentMethod(method.id, { enabled: event.target.checked })} /> Show this method to students</label><button className="button button-outline" type="button" onClick={() => removePaymentMethod(method.id)}>Remove method</button></div>
        </div>)}
        <button className="button button-outline" type="button" disabled={settings.paymentMethods.length >= 12} onClick={addPaymentMethod}>Add payment method</button>
      </div>
      <button className="button button-primary">Save settings</button>
    </form><aside className="panel capacity-panel"><div className="capacity-icon"><FolderOpen size={19} /></div><h3>Storage capacity</h3><p>Private media storage quota configured for this installation.</p><div className="capacity-amount"><strong>{formatStorage(storageUsed)}</strong><span>of {formatStorage(storageLimit)}</span></div><div className="capacity-track"><span style={{ width: `${Math.min(100, storageLimit ? storageUsed / storageLimit * 100 : 0)}%` }} /></div><span className="capacity-caption">{formatStorage(Math.max(0, storageLimit - storageUsed))} available</span></aside></div> : <div className="panel profile-panel"><p>Profile details are managed by your platform administrator.</p></div>}
  </>
}

function Modal({ modal, courses, paymentMethods, defaultSubscriptionDays, onClose, onAddCourse, onUpdateCourse, onAddChapter, onAddContent, onUpdateContent, onRemoveContent, onSubmitManualPayment, onDeleteCourse, onNotify }) {
  const [selectedCourseId, setSelectedCourseId] = useState(modal.courseId || '')
  const [selectedChapterId, setSelectedChapterId] = useState(modal.chapterId || '')
  const selectedCourse = courses.find((course) => course.id === selectedCourseId)
  const [selectedFile, setSelectedFile] = useState('')
  const [error, setError] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [couponDetails, setCouponDetails] = useState(null)
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState('')

  function submitCourse(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const course = {
      title: String(form.get('title')).trim(),
      description: String(form.get('description')).trim(),
      category: String(form.get('category') || 'Other'),
      subject: String(form.get('subject') || '').trim(),
      classLevel: String(form.get('classLevel') || '').trim(),
      price: Number(form.get('price') || 0),
      subscriptionDays: Number(form.get('subscriptionDays') || 365),
    }
    if (modal.type === 'edit-course') onUpdateCourse(modal.course.id, course)
    else onAddCourse({ ...course, instructor: '' })
  }

  function submitChapter(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onAddChapter(modal.courseId, { title: form.get('title').trim(), description: form.get('description').trim(), topic: String(form.get('topic') || '').trim() })
  }

  function submitContent(event) {
    event.preventDefault()
    if (!selectedCourse) { setError('Create a course and chapter before adding content.'); return }
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    const kind = form.get('kind')
    if (!file?.size) { setError('Choose a file to upload.'); return }
    const allowedVideo = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)
    if ((kind === 'lecture' && !allowedVideo) || (kind === 'material' && file.type !== 'application/pdf')) {
      setError(kind === 'lecture' ? 'Choose an MP4, WebM, or MOV video.' : 'Choose a PDF study material.')
      return
    }
    const content = kind === 'lecture'
      ? { kind, title: form.get('title').trim(), duration: form.get('duration') || '', quality: form.get('quality'), file }
      : { kind, title: form.get('title').trim(), format: form.get('format'), file }
    onAddContent(selectedCourseId, form.get('chapterId'), content)
  }

  function submitContentEdit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onUpdateContent(modal.content.id, { title: String(form.get('title')).trim() })
  }

  async function applyCoupon() {
    setCouponDetails(null)
    setError('')
    try {
      const response = await fetch(`/api/student/courses/${encodeURIComponent(purchaseTarget.id)}/coupon`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Coupon could not be applied.')
      setCouponDetails(result)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  let title = 'Add course'
  if (modal.type === 'chapter') title = 'Add chapter'
  if (modal.type === 'edit-course') title = 'Edit course details'
  if (modal.type === 'content') title = modal.kind === 'lecture' ? 'Add recorded lecture' : 'Add study material'
  if (modal.type === 'feedback') title = 'Share course feedback'
  if (modal.type === 'delete-course') title = 'Remove course'
  if (modal.type === 'edit-content') title = 'Edit content'
  if (modal.type === 'delete-content') title = 'Remove content'
  if (modal.type === 'purchase-content') title = modal.course ? 'Unlock course' : 'Purchase content'
  const courseToRemove = courses.find((course) => course.id === modal.courseId)
  const purchaseTarget = modal.course || modal.content

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><p className="eyebrow">PARAGON ACADEMY</p><h2>{title}</h2></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>
    {(modal.type === 'course' || modal.type === 'edit-course') && <form onSubmit={submitCourse}><FormField label="Course name"><input name="title" required maxLength="180" defaultValue={modal.course?.title || ''} placeholder="e.g. Introduction to visual design" /></FormField><FormField label="Short description"><textarea name="description" required maxLength="5000" defaultValue={modal.course?.description || ''} placeholder="What will students learn?" /></FormField><div className="form-two"><FormField label="Category"><select name="category" defaultValue={modal.course?.category || 'Design'}><option>Design</option><option>Business</option><option>Writing</option><option>Science</option><option>Technology</option><option>Photography</option><option>Other</option></select></FormField><FormField label="Subject"><input name="subject" maxLength="100" defaultValue={modal.course?.subject || ''} placeholder="e.g. Mathematics" /></FormField></div><div className="form-two"><FormField label="Class / grade level"><input name="classLevel" maxLength="100" defaultValue={modal.course?.classLevel || ''} placeholder="e.g. Grade 10" /></FormField><FormField label="Price (PKR)"><input name="price" type="number" min="0" step="1" defaultValue={modal.course?.price ?? ''} placeholder="0 for free" required /></FormField></div><FormField label="Subscription duration (days)"><input name="subscriptionDays" type="number" min="1" max="3650" defaultValue={modal.course?.subscriptionDays || defaultSubscriptionDays} required /></FormField>{modal.type === 'course' && <div className="modal-note"><CircleHelp size={14} />Add subject, grade, and topic labels to make the course curriculum easy to browse.</div>}<ModalActions onCancel={onClose} submit={modal.type === 'edit-course' ? 'Save course' : 'Create course'} /></form>}
    {modal.type === 'chapter' && <form onSubmit={submitChapter}><FormField label="Chapter title"><input name="title" required placeholder="e.g. Getting started" /></FormField><FormField label="Topic (optional)"><input name="topic" maxLength="100" placeholder="e.g. Fractions and decimals" /></FormField><FormField label="Chapter description"><textarea name="description" placeholder="Optional overview for this chapter" /></FormField><ModalActions onCancel={onClose} submit="Add chapter" /></form>}
    {modal.type === 'edit-content' && <form onSubmit={submitContentEdit}><FormField label="Title"><input name="title" defaultValue={modal.content.title} maxLength="180" required /></FormField><p className="modal-description">Course access is sold as a single subscription; uploaded materials do not have separate prices.</p><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary">Save changes <ArrowRight size={15} /></button></div></form>}
    {modal.type === 'delete-content' && <div><p className="modal-description">Remove <strong>{modal.content.title}</strong> and its server file? The material will no longer be available in the course.</p><div className="modal-actions"><button className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary button-danger" onClick={() => onRemoveContent(modal.content)}>Remove file <Trash2 size={15} /></button></div></div>}
    {modal.type === 'purchase-content' && <form onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const payload = {
        methodId: String(form.get('methodId') || ''),
        methodName: paymentMethods.find((method) => method.id === String(form.get('methodId') || ''))?.name || '',
        payerName: String(form.get('payerName') || '').trim(),
        transferReference: String(form.get('transferReference') || '').trim(),
        paymentDetails: String(form.get('paymentDetails') || '').trim(),
        couponCode: String(form.get('couponCode') || '').trim(),
      }
      const receipt = form.get('receipt')
      if (couponDetails?.amountPkr !== 0 && (!payload.methodId || !payload.payerName || !payload.transferReference || !receipt?.size)) {
        setError('Choose a payment method, enter the payer and transaction reference, and attach a payment screenshot.')
        return
      }
      setError('')
      onSubmitManualPayment(purchaseTarget, payload, receipt)
    }}>
      <p className="modal-description">Submit your payment for <strong>{purchaseTarget?.title}</strong>. The Owner verifies your transaction before unlocking the complete course.</p>
      <div className="enroll-price"><span>Course price</span><strong>{formatPkr(purchaseTarget?.pricePkr ?? purchaseTarget?.price ?? 0)}</strong></div>
      <div className="coupon-apply-row"><label className="form-field"><span>Coupon code</span><input name="couponCode" value={couponCode} maxLength="40" onChange={(event) => { setCouponCode(event.target.value); setCouponDetails(null) }} /></label><button type="button" className="button button-outline" disabled={!couponCode.trim()} onClick={applyCoupon}>Apply</button></div>
      {couponDetails && <div className="coupon-confirmation"><span>{couponDetails.code} applied · {formatPkr(couponDetails.discountPkr)} off</span><strong>Total: {formatPkr(couponDetails.amountPkr)}</strong></div>}
      {couponDetails?.amountPkr !== 0 && <>
        {paymentMethods.length ? <FormField label="Payment method"><select name="methodId" value={selectedPaymentMethodId || paymentMethods[0].id} onChange={(event) => setSelectedPaymentMethodId(event.target.value)}>{paymentMethods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}</select></FormField> : <div className="form-warning">The Owner has not configured any payment methods yet.</div>}
        {paymentMethods.find((method) => method.id === (selectedPaymentMethodId || paymentMethods[0]?.id))?.instructions && <div className="payment-instructions">{paymentMethods.find((method) => method.id === (selectedPaymentMethodId || paymentMethods[0]?.id)).instructions}</div>}
        <div className="form-two"><FormField label="Payer name"><input name="payerName" maxLength="100" placeholder="Name shown on the payment" required disabled={!paymentMethods.length} /></FormField><FormField label="Transaction / payment reference"><input name="transferReference" maxLength="100" placeholder="Transaction ID or reference number" required disabled={!paymentMethods.length} /></FormField></div>
        <FormField label="Other payment details (optional)"><textarea name="paymentDetails" maxLength="500" placeholder="Anything the reviewer should know" disabled={!paymentMethods.length} /></FormField>
        <FormField label="Payment screenshot (required)"><input name="receipt" type="file" accept="image/png,image/jpeg,image/webp" required disabled={!paymentMethods.length} /></FormField>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="payment-demo-note">{couponDetails?.amountPkr === 0 ? 'Your course will unlock immediately with this fully discounted coupon.' : 'Your payment screenshot and transaction details are sent to the Owner. Course videos and PDFs unlock after approval.'}</p>
      <ModalActions onCancel={onClose} submit={couponDetails?.amountPkr === 0 ? 'Unlock course' : 'Submit payment request'} disabled={couponDetails?.amountPkr !== 0 && paymentMethods.length === 0} />
    </form>}
    {modal.type === 'content' && <form onSubmit={submitContent}><FormField label="Course"><select name="courseId" value={selectedCourseId} onChange={(event) => { setSelectedCourseId(event.target.value); setSelectedChapterId('') }} required><option value="">Select a course</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></FormField>{!courses.length && <div className="form-warning">Create a course first, then add its chapters and learning content.</div>}<FormField label="Chapter"><select name="chapterId" value={selectedChapterId} onChange={(event) => setSelectedChapterId(event.target.value)} required><option value="">Choose a chapter</option>{selectedCourse?.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}</select></FormField><input type="hidden" name="kind" value={modal.kind || 'lecture'} />{modal.kind === 'lecture' ? <><FormField label="Lecture title"><input name="title" required placeholder="Name this recorded lesson" /></FormField><div className="form-two"><FormField label="Video quality"><select name="quality"><option>HD 1080p</option><option>HD 720p</option></select></FormField><FormField label="Duration"><input name="duration" placeholder="e.g. 12:30" /></FormField></div></> : <><FormField label="Material title"><input name="title" required placeholder="Name this study resource" /></FormField><FormField label="File type"><select name="format"><option>PDF</option></select></FormField></>}<FormField label="Select file"><div className="file-picker"><Upload size={17} /><span>{selectedFile || 'Choose a file from your device'}</span><input name="file" type="file" accept={modal.kind === 'lecture' ? 'video/mp4,video/webm,video/quicktime' : '.pdf,application/pdf'} required onChange={(event) => setSelectedFile(event.target.files?.[0]?.name || '')} /></div></FormField><p className="upload-disclaimer">Upload videos and PDFs into course chapters. Students unlock all course materials together through one course subscription.</p>{error && <p className="form-error">{error}</p>}<ModalActions onCancel={onClose} submit={modal.kind === 'lecture' ? 'Upload lecture' : 'Upload PDF'} disabled={!courses.length || !selectedCourse?.chapters.length || !selectedChapterId} /></form>}
    {modal.type === 'delete-course' && <div><p className="modal-description">Remove <strong>{courseToRemove?.title}</strong>? This also removes its chapters, materials, and local enrollment/payment records. This can’t be undone.</p><div className="delete-warning"><Trash2 size={17} /><span>Students will no longer see or access this course.</span></div><ModalActions onCancel={onClose} submit="Remove course" onSubmit={() => onDeleteCourse(modal.courseId)} /></div>}
    {modal.type === 'feedback' && <FeedbackForm onClose={onClose} onNotify={onNotify} />}
  </section></div>
}

function FormField({ label, children }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}

function ModalActions({ onCancel, submit, onSubmit, disabled = false }) {
  return <div className="modal-actions"><button type="button" className="button button-outline" onClick={onCancel}>Cancel</button><button type={onSubmit ? 'button' : 'submit'} disabled={disabled} className="button button-primary" onClick={onSubmit}>{submit}<ArrowRight size={15} /></button></div>
}

function FeedbackForm({ onClose, onNotify }) {
  const [rating, setRating] = useState(0)
  function submit(event) {
    event.preventDefault()
    onClose()
    onNotify('Feedback saved in this prototype.')
  }
  return <form onSubmit={submit}><p className="modal-description">Your feedback helps improve the course experience.</p><div className="rating-picker" aria-label="Course rating">{[1, 2, 3, 4, 5].map((value) => <button type="button" aria-label={`${value} star${value > 1 ? 's' : ''}`} className={rating >= value ? 'star-active' : ''} key={value} onClick={() => setRating(value)}>★</button>)}</div><FormField label="Your review"><textarea required placeholder="What worked well? What could be improved?" /></FormField><ModalActions onCancel={onClose} submit="Submit feedback" disabled={!rating} /></form>
}

export default App
