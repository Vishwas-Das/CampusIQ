"""Model package for Alembic autogenerate discovery.

All models must be imported here so Alembic picks them up during `revision --autogenerate`.
"""

from app.core.database import Base
from app.models.ai_cache import AIResponseCache, AIUsageLog
from app.models.algorithm import (
    CompanySkillRequirement,
    NotificationDelivery,
    NotificationStatus,
    NotificationType,
    QuizSimilarityFlag,
    QuizTimeSlot,
    SkillGraphEdge,
    SkillNode,
    StudyOptimizerResult,
    WeeklySchedule,
)
from app.models.chat import ChatMessage, ChatSession, ChatType, MessageRole
from app.models.community import Doubt, DoubtAnswer
from app.models.crash_mode import CrashModePlan
from app.models.content import (
    Announcement,
    AnnouncementTarget,
    CollegeDocument,
    CollegeDocumentCategory,
    CollegeDocumentChunk,
    DocumentChunk,
)
from app.models.gamification import (
    Badge,
    CampusIQScore,
    Challenge,
    ChallengeEntry,
    ChallengeType,
    SkillTreeProgress,
    XPEvent,
    XPEventType,
)
from app.models.placement import (
    ApplicationStatus,
    ConfidenceSession,
    InterviewMode,
    InterviewPersona,
    InterviewStatus,
    JobApplication,
    JobListing,
    JobListingSource,
    JobType,
    MockInterviewSession,
    Resume,
)
from app.models.quiz import Difficulty, Question, QuestionFlag, QuestionType, Quiz, QuizAttempt
from app.models.user import (
    College,
    Document,
    DocumentStatus,
    StudentProfile,
    Subject,
    TeacherProfile,
    User,
    UserRole,
)

__all__ = [
    "Base",
    # AI cache + usage tracking
    "AIResponseCache",
    "AIUsageLog",
    # Users
    "College",
    "User",
    "UserRole",
    "StudentProfile",
    "TeacherProfile",
    "Subject",
    "Document",
    "DocumentStatus",
    # Content
    "DocumentChunk",
    "CollegeDocument",
    "CollegeDocumentCategory",
    "CollegeDocumentChunk",
    "Announcement",
    "AnnouncementTarget",
    # Chat
    "ChatSession",
    "ChatMessage",
    "ChatType",
    "MessageRole",
    # Quiz
    "Quiz",
    "Question",
    "QuizAttempt",
    "QuestionFlag",
    "Difficulty",
    "QuestionType",
    # Community
    "Doubt",
    "DoubtAnswer",
    # Crash Mode
    "CrashModePlan",
    # Placement
    "Resume",
    "MockInterviewSession",
    "ConfidenceSession",
    "JobListing",
    "JobApplication",
    "InterviewMode",
    "InterviewPersona",
    "InterviewStatus",
    "JobType",
    "JobListingSource",
    "ApplicationStatus",
    # Gamification
    "XPEvent",
    "XPEventType",
    "SkillTreeProgress",
    "Badge",
    "Challenge",
    "ChallengeEntry",
    "ChallengeType",
    "CampusIQScore",
    # Algorithm features
    "SkillGraphEdge",
    "SkillNode",
    "CompanySkillRequirement",
    "StudyOptimizerResult",
    "NotificationDelivery",
    "NotificationType",
    "NotificationStatus",
    "QuizSimilarityFlag",
    "WeeklySchedule",
    "QuizTimeSlot",
]
