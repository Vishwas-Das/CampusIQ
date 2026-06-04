from fastapi import APIRouter

from app.api.routes import (
    admin,
    algorithms,
    boss_battles,
    analytics,
    announcements,
    auth,
    chat,
    college_documents,
    community,
    confidence,
    crash_mode,
    dashboard,
    documents,
    gamification,
    interviews,
    jobs,
    notifications,
    public_profile,
    quizzes,
    resume,
    skills,
    subjects,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(subjects.router, prefix="/subjects", tags=["subjects"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(
    college_documents.router,
    prefix="/college-documents",
    tags=["college-documents"],
)
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(quizzes.router, prefix="/quizzes", tags=["quizzes"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(
    announcements.router, prefix="/announcements", tags=["announcements"]
)
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(resume.router, prefix="/resume", tags=["resume"])
api_router.include_router(skills.router, prefix="/skills", tags=["skills"])
api_router.include_router(interviews.router, prefix="/interviews", tags=["interviews"])
api_router.include_router(confidence.router, prefix="/confidence", tags=["confidence"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(community.router, prefix="/community", tags=["community"])
api_router.include_router(gamification.router, prefix="/gamification", tags=["gamification"])
api_router.include_router(algorithms.router, prefix="/algorithms", tags=["algorithms"])
api_router.include_router(crash_mode.router, prefix="/crash-mode", tags=["crash-mode"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(notifications.router, prefix="/ws", tags=["websockets"])
api_router.include_router(boss_battles.router, prefix="/boss-battles", tags=["boss-battles"])
api_router.include_router(public_profile.router, prefix="/profile/public", tags=["public-profile"])
