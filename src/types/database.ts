export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  common: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
  memocards: {
    Tables: {
      user_settings: {
        Row: {
          user_id: string
          daily_goal: number
          default_voice: string
          default_locale: string
          auto_play_audio: boolean
          study_streak: number
          longest_streak: number
          last_study_date: string | null
          total_sessions: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          daily_goal?: number
          default_voice?: string
          default_locale?: string
          auto_play_audio?: boolean
          study_streak?: number
          longest_streak?: number
          last_study_date?: string | null
          total_sessions?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          daily_goal?: number
          default_voice?: string
          default_locale?: string
          auto_play_audio?: boolean
          study_streak?: number
          longest_streak?: number
          last_study_date?: string | null
          total_sessions?: number
          updated_at?: string
        }
      }
      folders: {
        Row: {
          id: string
          user_id: string
          name: string
          color: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          color: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          color?: string
          updated_at?: string
        }
      }
      decks: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string
          folder_id: string | null
          tags: string[]
          counts: Json
          preferences: Json
          export_config: Json
          ai_config: Json
          created_at: string
          updated_at: string
          last_studied_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          description?: string
          folder_id?: string | null
          tags?: string[]
          counts?: Json
          preferences?: Json
          export_config?: Json
          ai_config?: Json
          created_at?: string
          updated_at?: string
          last_studied_at?: string | null
        }
        Update: {
          title?: string
          description?: string
          folder_id?: string | null
          tags?: string[]
          counts?: Json
          preferences?: Json
          export_config?: Json
          ai_config?: Json
          updated_at?: string
          last_studied_at?: string | null
        }
      }
      cards: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          type: string
          front: string
          back: string
          prompt: string
          answer: string
          explanation: string
          choices: Json
          expected_answer: Json
          tags: string[]
          is_favorite: boolean
          review_state: Json
          study_stats: Json
          audio: Json
          ai_evaluation: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          type: string
          front?: string
          back?: string
          prompt?: string
          answer?: string
          explanation?: string
          choices?: Json
          expected_answer?: Json
          tags?: string[]
          is_favorite?: boolean
          review_state?: Json
          study_stats?: Json
          audio?: Json
          ai_evaluation?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          type?: string
          front?: string
          back?: string
          prompt?: string
          answer?: string
          explanation?: string
          choices?: Json
          expected_answer?: Json
          tags?: string[]
          is_favorite?: boolean
          review_state?: Json
          study_stats?: Json
          audio?: Json
          ai_evaluation?: Json
          updated_at?: string
        }
      }
      audio_generation_queue: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          card_id: string
          side: 'prompt' | 'answer'
          source_text: string
          status: 'queued' | 'processing' | 'ready' | 'failed'
          attempts: number
          last_error: string | null
          requested_at: string
          started_at: string | null
          finished_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          card_id: string
          side: 'prompt' | 'answer'
          source_text?: string
          status?: 'queued' | 'processing' | 'ready' | 'failed'
          attempts?: number
          last_error?: string | null
          requested_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          deck_id?: string
          card_id?: string
          side?: 'prompt' | 'answer'
          source_text?: string
          status?: 'queued' | 'processing' | 'ready' | 'failed'
          attempts?: number
          last_error?: string | null
          requested_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
      }
      activity: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          description: string
          deck_id: string | null
          card_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          description: string
          deck_id?: string | null
          card_id?: string | null
          created_at?: string
        }
        Update: never
      }
      sessions: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          deck_title: string
          mode: string
          started_at: string
          ended_at: string
          cards_studied: number
          correct: number
          incorrect: number
          duration_seconds: number
          results: Json
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          deck_title: string
          mode: string
          started_at: string
          ended_at: string
          cards_studied: number
          correct: number
          incorrect: number
          duration_seconds: number
          results: Json
        }
        Update: never
      }
      answer_evaluations: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          card_id: string
          prompt: string
          expected_answer: Json
          submitted_answer: string
          status: string
          processor: string | null
          pipeline_version: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          card_id: string
          prompt: string
          expected_answer: Json
          submitted_answer: string
          status: string
          processor?: string | null
          pipeline_version?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          status?: string
          processor?: string | null
          pipeline_version?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      claim_audio_generation_jobs: {
        Args: {
          limit_count: number
          target_user_id?: string | null
          target_deck_id?: string | null
        }
        Returns: Database['memocards']['Tables']['audio_generation_queue']['Row'][]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
