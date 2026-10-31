import { renderToString } from "react-dom/server"
import { Hosted } from "./Hosted"

// No request, account props, or server fetch: effects run only in the browser.
export const render = (devicePage: boolean) => renderToString(<Hosted devicePage={devicePage} />)
