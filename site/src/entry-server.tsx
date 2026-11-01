import { renderToString } from "react-dom/server"
import { App } from "./App"
import { Hosted } from "./hosted/Hosted"

export const render = () => renderToString(<App />)
export const renderHosted = (devicePage: boolean, sharesPage = false) => renderToString(<Hosted devicePage={devicePage} sharesPage={sharesPage} />)
export { mapPage } from "./map/page"
