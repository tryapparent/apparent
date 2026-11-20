import Base

def show_nightly_download(mac: Bool, nightly: Bool) -> Bool:
  Bool.and(mac, Bool.not(nightly))
