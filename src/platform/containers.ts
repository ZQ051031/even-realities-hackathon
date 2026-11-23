import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk'
import type { Page } from '../core/page'

/** Converts a Glance page into Even Hub SDK container objects. */
export function toContainers(page: Page) {
  const textObject = page.texts.map(
    t =>
      new TextContainerProperty({
        xPosition: t.x,
        yPosition: t.y,
        width: t.w,
        height: t.h,
        borderWidth: t.border ?? 0,
        borderColor: 5,
        borderRadius: t.radius ?? 0,
        paddingLength: t.padding ?? 0,
        containerID: t.id,
        containerName: t.name,
        content: t.content,
        isEventCapture: t.capture ? 1 : 0,
        ...(t.color !== undefined ? { textColor: t.color } : {}),
      }),
  )
  const listObject = page.list
    ? [
        new ListContainerProperty({
          xPosition: page.list.x,
          yPosition: page.list.y,
          width: page.list.w,
          height: page.list.h,
          borderWidth: page.list.border ?? 0,
          borderColor: 5,
          paddingLength: page.list.padding ?? 0,
          containerID: page.list.id,
          containerName: page.list.name,
          isEventCapture: page.list.capture ? 1 : 0,
          itemContainer: new ListItemContainerProperty({
            itemCount: page.list.items.length,
            itemWidth: page.list.w - 2 * (page.list.padding ?? 0),
            isItemSelectBorderEn: 1,
            itemName: page.list.items,
          }),
        }),
      ]
    : undefined
  const menuObject = new MenuContainerProperty({
    menuItems: page.menu.map(m => new MenuItemProperty({ itemName: m.name, itemID: m.id })),
  })
  return {
    containerTotalNum: textObject.length + (listObject?.length ?? 0),
    textObject,
    ...(listObject ? { listObject } : {}),
    menuObject,
  }
}

export const toStartUp = (page: Page) => new CreateStartUpPageContainer(toContainers(page))
export const toRebuild = (page: Page) => new RebuildPageContainer(toContainers(page))
