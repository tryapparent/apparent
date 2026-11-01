import { createElement } from "react"
import { footerMarkup } from "./footer/markup"
import "./footer/behavior"
import "./footer/footer.css"

export function Footer() {
  return <footer className="frog-footer">{createElement("apparent-footer", {
    dangerouslySetInnerHTML: { __html: footerMarkup },
  })}</footer>
}
