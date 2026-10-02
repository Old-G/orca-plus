import { describe, expect, it } from 'vitest'
import { readHqClickUpBinding, withHqClickUpBinding } from './hq-project-clickup'

const SHOP = { listId: 'l1', listName: 'Dev / Shop', spaceId: 's1' }

describe('hq project ClickUp lists', () => {
  it('reads a stored link and drops records that do not fit', () => {
    expect(readHqClickUpBinding({ shop: SHOP }, 'shop')).toEqual(SHOP)
    expect(readHqClickUpBinding({ shop: { listId: 'l1', spaceId: 's1' } }, 'shop')).toEqual({
      listId: 'l1',
      spaceId: 's1',
      listName: 'l1'
    })
    expect(readHqClickUpBinding({ shop: { listId: 'l1' } }, 'shop')).toBeNull()
    expect(readHqClickUpBinding({ shop: 'l1' }, 'shop')).toBeNull()
    expect(readHqClickUpBinding(undefined, 'shop')).toBeNull()
    expect(readHqClickUpBinding({ shop: SHOP }, 'blog')).toBeNull()
  })

  it('sets and removes one project without touching the others', () => {
    const blog = { listId: 'l2', listName: 'Blog', spaceId: 's1' }
    const both = withHqClickUpBinding({ blog }, 'shop', SHOP)
    expect(both).toEqual({ blog, shop: SHOP })
    expect(withHqClickUpBinding(both, 'shop', null)).toEqual({ blog })
    expect(withHqClickUpBinding(undefined, 'shop', SHOP)).toEqual({ shop: SHOP })
  })
})
