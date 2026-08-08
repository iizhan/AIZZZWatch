import { apiClient } from './client'

export interface RecommendationModelOption {
  key: string
  name: string
  sort_order: number
  enabled: boolean
}

export interface RecommendationReward {
  id: number
  recommendation_id: number
  reward_type: 'profit_share' | 'one_time_credit'
  amount: number
  share_percent: number
  cap_amount: number
  expires_at?: string
  transferred_amount: number
  available_amount: number
  admin_note?: string
}

export interface Recommendation {
  id: number
  user_id: number
  site_url: string
  model_key: string
  submitted_multiplier: number
  requested_reward_type: 'profit_share' | 'one_time_credit'
  note?: string
  status: 'pending' | 'adopted' | 'rejected'
  decision_reason?: string
  adopted_at?: string
  created_at: string
  reward?: RecommendationReward
}

export interface PublicPricing {
  id: number
  public_name: string
  platform: string
  effective_multiplier: number
  observed_at: string
}

export interface PublicPricingAdminRow {
  source_id: number
  group_external_id: string
  source_name: string
  group_name: string
  platform: string
  effective_multiplier: number
  public_name: string
  enabled: boolean
}

export const recommendationAPI = {
  getModels() { return apiClient.get<RecommendationModelOption[]>('/user/recommendations/models') },
  listMine() { return apiClient.get<Recommendation[]>('/user/recommendations') },
  create(data: { site_url: string; model_key: string; multiplier: number; reward_type: string; note?: string }) {
    return apiClient.post<Recommendation>('/user/recommendations', data)
  },
  transfer() { return apiClient.post<{ transferred_amount: number }>('/user/recommendations/transfer') },
  getPublicPricing() { return apiClient.get<PublicPricing[]>('/user/public-pricing') },
  adminList(status?: string) { return apiClient.get<Recommendation[]>('/admin/recommendations', { params: { status } }) },
  adminListPublicPricing() { return apiClient.get<PublicPricingAdminRow[]>('/admin/recommendations/public-pricing') },
  adminSavePublicPricing(data: Pick<PublicPricingAdminRow, 'source_id' | 'group_external_id' | 'public_name' | 'enabled'>) {
    return apiClient.put('/admin/recommendations/public-pricing', data)
  },
  adminListModels() { return apiClient.get<RecommendationModelOption[]>('/admin/recommendations/models') },
  adminSaveModel(data: RecommendationModelOption) { return apiClient.put('/admin/recommendations/models', data) },
  adminDecide(id: number, data: { adopted: boolean; reason: string; reward_type?: string; amount?: number; share_percent?: number; cap_amount?: number; admin_note?: string }) {
    return apiClient.post<Recommendation>(`/admin/recommendations/${id}/decision`, data)
  }
}
