import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/api/client', () => ({ apiClient: { post } }))

import { updateBalance } from '@/api/admin/users'

describe('admin user balance API', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({ data: { id: 42, balance: 130 } })
  })

  it('sends the bonus payload and idempotency key separately', async () => {
    await updateBalance(42, {
      balance: 100,
      bonus_amount: 20,
      operation: 'add',
      notes: 'campaign',
      idempotencyKey: 'admin-recharge-key'
    })

    expect(post).toHaveBeenCalledWith(
      '/admin/users/42/balance',
      { balance: 100, bonus_amount: 20, operation: 'add', notes: 'campaign' },
      { headers: { 'Idempotency-Key': 'admin-recharge-key' } }
    )
  })
})
