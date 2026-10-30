import type { Page } from "@playwright/test";
/** Use the visible account options menu, or a legacy standalone tool button. */
export async function openAccountOption(page:Page,t:(key:string)=>string,key:string){const direct=page.locator(".password-vault-toolbar").getByRole("button",{name:t(key),exact:true});if(await direct.count()&&await direct.isVisible()){await direct.click();return;}await page.locator(".account-options-trigger").click();await page.getByRole("menuitem",{name:t(key),exact:true}).click();}
