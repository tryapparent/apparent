import { createElement } from "react"
import { footerMarkup } from "./markup"
import "./behavior"
import "./footer.css"

export function Footer() {
  return <footer className="frog-footer">{createElement("apparent-footer", {
    dangerouslySetInnerHTML: { __html: footerMarkup },
  })}</footer>
}
