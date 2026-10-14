import { useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Eye, EyeOff, GraduationCap, LockKeyhole, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { readApiResponse } from './apiResponse.js'
import './auth.css'

export default function AuthScreen({ onAuthenticated, initialRole = 'student', adminOnly = false, startWithSignup = false }) {
  const [screen, setScreen] = useState(startWithSignup ? 'signup' : 'signin')
  const [role, setRole] = useState(initialRole)
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function openScreen(nextScreen) {
    setScreen(nextScreen)
    setError('')
    setOtp('')
  }

  function openStudentSignup() {
    setRole('student')
    openScreen('signup')
  }

  async function completeSignIn(account) {
    try {
      await onAuthenticated({ name: account.name, email: account.email, role: account.role })
    } catch (signInError) {
      setError(signInError.message || 'Unable to complete sign in.')
      setBusy(false)
    }
  }

  async function submitSignIn(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password'), role }),
      })
      const result = await readApiResponse(response, 'Unable to sign in.')
      await completeSignIn(result.user)
    } catch (error) {
      setError(error.message || 'Unable to connect to the API.')
    } finally {
      setBusy(false)
    }
  }

  async function beginSignup(event) {
    event.preventDefault()
    if (role !== 'student') {
      setError('Teacher and owner accounts are created by the workspace owner.')
      return
    }
    const form = new FormData(event.currentTarget)
    const signup = {
      name: String(form.get('name')).trim(),
      phone: String(form.get('phone')).trim(),
      email: String(form.get('email')).trim().toLowerCase(),
      password: String(form.get('password')),
      role: 'student',
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signup),
      })
      const result = await readApiResponse(response, 'Unable to start student registration.')
      await completeSignIn(result.user)
    } catch (signupError) {
      setError(signupError.message || 'Unable to connect to the API.')
    } finally {
      setBusy(false)
    }
  }

  async function sendResetOtp(event) {
    event.preventDefault()
    const typedEmail = String(new FormData(event.currentTarget).get('email')).trim().toLowerCase()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typedEmail, role }),
      })
      await readApiResponse(response, 'Unable to request a reset code.')
      setEmail(typedEmail)
      openScreen('reset-otp')
    } catch (resetError) {
      setError(resetError.message || 'Unable to connect to the API.')
    } finally {
      setBusy(false)
    }
  }

  function verifyResetOtp(event) {
    event.preventDefault()
    setResetCode(otp)
    openScreen('new-password')
  }

  async function saveNewPassword(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirmPassword'))) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: resetCode, password }),
      })
      const result = await readApiResponse(response, 'Unable to reset password.')
      await completeSignIn(result.user)
    } catch (resetError) {
      setError(resetError.message || 'Unable to connect to the API.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-layout">
    <section className="auth-aside">
      <a className="auth-brand" href="/"><img src="/paragon-academy-logo.png" alt="" /><span>Paragon Academy</span></a>
      <div className="auth-aside-copy"><p className="auth-eyebrow">YOUR LEARNING SPACE</p><h1>Make room<br />for what’s next.</h1><p>One thoughtful lesson can open up a whole new direction.</p></div>
      <div className="auth-aside-art" aria-hidden="true"><div className="auth-art-panel"><div className="auth-art-sun" /><div className="auth-art-stem" /><div className="auth-art-leaf leaf-one" /><div className="auth-art-leaf leaf-two" /><div className="auth-art-book"><GraduationCap size={31} /></div></div><span className="auth-art-note">learn at your own pace</span></div>
      <div className="auth-aside-foot"><ShieldCheck size={15} /> A space for students and teachers</div>
    </section>
    <section className="auth-main"><div className="auth-card-wrap"><div className="auth-mobile-brand"><img src="/paragon-academy-logo.png" alt="" /><span>Paragon Academy</span></div>
      <div className="auth-card">
        {screen === 'signin' && <>
          <p className="auth-eyebrow">{adminOnly ? 'OWNER ACCESS' : 'WELCOME BACK'}</p><h2>{adminOnly ? 'Owner sign in' : 'Sign in to Paragon Academy'}</h2><p className="auth-subtitle">{adminOnly ? 'Sign in to manage your academy workspace.' : 'Choose your workspace and continue learning.'}</p>
          {!adminOnly && <RolePicker role={role} onChange={(value) => { setRole(value); setError('') }} />}
          <form onSubmit={submitSignIn}>
            <AuthField label="Email address" icon={Mail}><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></AuthField>
            <AuthField label="Password" icon={LockKeyhole}><input name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" placeholder="Enter your password" /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></AuthField>
            <div className="auth-between"><label className="remember-check"><input type="checkbox" />Remember me</label><button className="auth-text-button" type="button" onClick={() => openScreen('forgot')}>Forgot password?</button></div>
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}<ArrowRight size={16} /></button>
          </form>
          {!adminOnly && (role === 'student'
            ? <p className="auth-switch">New to Paragon Academy? <button onClick={openStudentSignup}>Create a student account</button></p>
            : <p className="auth-switch admin-provision-note">Teacher accounts are created by the workspace owner.</p>)}
        </>}
        {screen === 'signup' && !adminOnly && <>
          <button className="auth-back" onClick={() => openScreen('signin')}><ArrowLeft size={14} />Back to sign in</button><p className="auth-eyebrow">STUDENT REGISTRATION</p><h2>Create your student account</h2><p className="auth-subtitle">Sign up to explore courses and track your learning.</p>
          <form onSubmit={beginSignup}>
            <AuthField label="Full name" icon={UserRound}><input name="name" required autoComplete="name" placeholder="Your name" /></AuthField>
            <AuthField label="Email address" icon={Mail}><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></AuthField>
            <AuthField label="Contact number" icon={Phone}><input name="phone" type="tel" autoComplete="tel" placeholder="+92 3XX XXXXXXX" /></AuthField>
            <AuthField label="Create password" icon={LockKeyhole}><input name="password" type="password" required minLength="8" autoComplete="new-password" placeholder="At least 8 characters" /></AuthField>
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <ArrowRight size={16} /></button>
          </form>
          <p className="auth-switch">Already have an account? <button onClick={() => openScreen('signin')}>Sign in</button></p>
        </>}
        {screen === 'forgot' && <>
          <button className="auth-back" onClick={() => openScreen('signin')}><ArrowLeft size={14} />Back to sign in</button><div className="auth-step-icon"><LockKeyhole size={20} /></div><p className="auth-eyebrow">ACCOUNT RECOVERY</p><h2>Reset your password</h2><p className="auth-subtitle">We’ll send a one-time code to the email on your {role} account.</p>
          <form onSubmit={sendResetOtp}><AuthField label="Email address" icon={Mail}><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></AuthField>{error && <p className="auth-error">{error}</p>}<button className="auth-submit">Send verification code <ArrowRight size={16} /></button></form>
        </>}
        {screen === 'reset-otp' && <>
          <button className="auth-back" onClick={() => openScreen('forgot')}><ArrowLeft size={14} />Back</button><div className="auth-step-icon"><Mail size={20} /></div><p className="auth-eyebrow">PASSWORD RESET</p><h2>Enter your code</h2><p className="auth-subtitle">We sent a six-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>
          <form onSubmit={verifyResetOtp}><AuthField label="One-time code" icon={ShieldCheck}><input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required placeholder="000000" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></AuthField>{error && <p className="auth-error">{error}</p>}<button className="auth-submit">Verify code <ArrowRight size={16} /></button></form>
        </>}
        {screen === 'new-password' && <>
          <button className="auth-back" onClick={() => openScreen('signin')}><ArrowLeft size={14} />Back to sign in</button><div className="auth-step-icon"><LockKeyhole size={20} /></div><p className="auth-eyebrow">SECURE YOUR ACCOUNT</p><h2>Choose a new password</h2><p className="auth-subtitle">Create a password you haven’t used before.</p>
          <form onSubmit={saveNewPassword}><AuthField label="New password" icon={LockKeyhole}><input name="password" type="password" required minLength="8" autoComplete="new-password" placeholder="At least 8 characters" /></AuthField><AuthField label="Confirm new password" icon={LockKeyhole}><input name="confirmPassword" type="password" required minLength="8" autoComplete="new-password" placeholder="Enter it again" /></AuthField>{error && <p className="auth-error">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}<ArrowRight size={16} /></button></form>
        </>}
        <p className="auth-legal">By continuing, you agree to the Paragon Academy terms and privacy policy.</p>
      </div>
      <p className="auth-prototype-note">Password-reset codes require email delivery to be configured by the administrator.</p>
    </div></section>
  </main>
}

function RolePicker({ role, onChange }) {
  return <div className="role-picker" aria-label="Account type"><button type="button" className={role === 'student' ? 'selected' : ''} onClick={() => onChange('student')}><BookOpen size={15} />Student</button><button type="button" className={role === 'teacher' ? 'selected' : ''} onClick={() => onChange('teacher')}><GraduationCap size={15} />Teacher</button></div>
}

function AuthField({ label, icon: Icon, children }) {
  return <label className="auth-field"><span>{label}</span><span className="auth-input-wrap"><Icon size={16} />{children}</span></label>
}
