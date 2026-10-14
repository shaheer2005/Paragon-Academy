# Paragon Academy

Paragon Academy is a responsive course-based learning platform built with React, Vite, Express, and SQLite. It provides separate Owner, Teacher, and Student workspaces. The Owner manages users, courses, permissions, subscriptions, payment reviews, and platform settings; Teachers work only in assigned courses and within permissions granted by the Owner; Students browse courses and access learning materials after a course subscription is active.

## Local development

Install dependencies with `npm install`. Create an ignored local `.env` from `.env.example` and set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` before starting the API. Student signup creates the account and signs the student in directly without email verification. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` only if you want email-based password resets. The sender address must belong to a domain verified in Resend. Do not commit local environment files or production credentials.

Start the API and frontend together:

```powershell
npm run dev
```

Open `http://localhost:5173` to view the public learning overview. Students and teachers use the sign-in page; Owner sign-in is separate at `/admin` and is not offered in the student/teacher role picker. The development command starts the API and Vite frontend together; Vite proxies `/api` requests to the API port (`3001` by default, or `API_PORT` if configured). To run the services separately, use `npm run api` and `npm run dev:frontend` in separate terminals. Development test sessions and course-purchase shortcuts are available only when `NODE_ENV` is not `production` and `ALLOW_DEV_SESSIONS=true`.

## Courses and protected media

- An Owner creates a course, labels its subject and class/grade level, sets its price and subscription duration, then organizes chapters with optional topic labels and protected lecture/PDF materials.
- Teachers are provisioned by the Owner and can only access assigned courses/chapters and explicitly granted permissions.
- Students purchase a complete course package; individual videos and PDFs are not sold separately.
- The Owner configures one or more manual payment methods and publishes the payment instructions/account details. At checkout, students choose a method, enter the payer name and transaction reference, and submit a payment screenshot. Requests stay pending until the Owner checks the proof and approves or rejects them; approval activates the complete course subscription and rejection keeps course media locked. Course coupons can be global or course-scoped, fixed-amount or percentage discounts, with expiry and redemption limits; full-discount coupons unlock access immediately.
- Media is stored outside the public web root and streamed through authenticated endpoints. The application checks the viewer's course access before serving a file.
- Videos support MP4, WebM, and MOV up to 5 GB each, with no fixed lecture-count cap. PDFs are limited to 100 MB each. The default total media quota is 500 GB; configure it with `MAX_STORAGE_BYTES`.
- Video progress is saved while a Student watches. Certificates can be issued after all course lessons are complete and each published assessment has a submitted attempt. Issued certificates have public verification codes and a print-friendly page.

The development-only test purchase does not charge money. Manual payment verification is available; no payment gateway or automated payment reconciliation is integrated. Password-reset codes are sent through Resend and require a valid `RESEND_API_KEY` and verified `RESEND_FROM_EMAIL` configured on the API server. Signup does not use email delivery or verification. SMS/WhatsApp delivery and cloud/object storage also need a provider, deployment policy, and credentials before they can be enabled. Live classes use external HTTP(S) meeting links and manually recorded attendance; authorized staff can link an uploaded course lecture as the class recording. Authenticated streaming protects access but cannot prevent a viewer from capturing media delivered to their device.

## LMS features

- Owner-managed Teacher accounts, course/chapter assignments, and per-Teacher permissions.
- Owner student directory and account activation controls.
- Course chapters, lectures, PDFs, course publishing, subscription management, and private media storage.
- Course quizzes and tests with multiple-choice questions, randomization, time limits, automatic scoring, and attempt history.
- Course assignments with written student submissions, teacher/Owner grading, and feedback notifications.
- Course discussion threads and replies, with course-access checks and Owner/permissioned-Teacher moderation.
- Private student-to-assigned-teacher question threads, Owner-controlled Teacher opt-in, and in-app reply notifications.
- Student opt-in course leaderboards. Only the Student's first name and a transparent learning score are shown; the score combines course lesson completion and assessment averages.
- Lecture progress and Owner/authorized Teacher progress reports.
- Scheduled live classes, student notifications/announcements, student attendance history, and protected recordings linked to course lectures.
- Course/lecture/Teacher feedback, authorized replies, and notifications.
- Owner analytics for users, courses, subscriptions, payments, assessments, and feedback, plus course-scoped teacher performance reports.
- Completion certificates with public code verification, optional learning leaderboards, course coupons, and subject/topic organization.
- Responsive Student, Teacher, and Owner views.

## API and deployment

SQLite data and private media use `API_DATA_DIR` and `MEDIA_STORAGE_DIR` (defaults are under `server/`). `GET /api/health` reports API and storage health. The authenticated media endpoint is `GET /api/content/:id/stream`.

### Deploy frontend to Vercel and API to Render

The repository includes a Render Blueprint (`render.yaml`) for the API and its persistent disk, plus `vercel.json` to build the Vite frontend, route `/api/*` to Render, and preserve client-side routes. The Render disk stores both SQLite and private course uploads. SQLite requires one API instance; do not enable multiple instances or autoscaling for this setup.

1. Push the repository to GitHub and create a Render Blueprint from it. Confirm the paid **Starter** web service and 10 GB persistent disk in Render before applying the Blueprint; the disk is required so database and uploaded files survive deploys and restarts.
2. In the Render service's Environment settings, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (use a strong unique password) and optionally `ADMIN_NAME`. The Owner account is created on first startup when those values are present. Do not put production secrets in the repository.
3. Wait for the Render service to become healthy at `/api/health`. Its default service URL is `https://paragon-academy-api.onrender.com`, matching the Vercel rewrite in `vercel.json`. If Render assigns another URL, update the rewrite destination to that exact HTTPS URL and push the change.
4. Import the same GitHub repository as a Vercel project. Use the repository root as the project root and the included build settings (`npm run build`, output directory `dist`). Deploy after the Render API is healthy.
5. Open the Vercel deployment and verify the public homepage, `/signin`, `/signup`, and `/admin`. Sign in as Owner using the Render `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

The Vercel rewrite keeps browser API requests same-origin, which allows the production session cookie to work without exposing credentials to frontend code. Do not remove the `/api/(.*)` rewrite. The included Render setup uses SQLite on a persistent disk rather than managed PostgreSQL; migrating to PostgreSQL would require a separate database/API migration. Increase both the Render disk size and `MAX_STORAGE_BYTES` if you need more than the configured 9 GiB media quota. Back up the SQLite database and private uploads independently. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Render only if password-reset email is required.

Configure a real payment provider and external notification/conferencing services before relying on those integrations. Attendance is staff-marked and is not verified by the meeting provider. Assignment responses are text-only. The configured `MAX_STORAGE_BYTES` is an application quota, not a cloud storage contract.
