import zipfile, urllib.request, io, sys
class R(io.RawIOBase):
    def __init__(s,url):
        s.url=url; s.pos=0
        r=urllib.request.urlopen(urllib.request.Request(url,method='HEAD')); s.size=int(r.headers['content-length'])
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.pos
    def seek(s,o,w=0):
        s.pos = o if w==0 else s.pos+o if w==1 else s.size+o; return s.pos
    def read(s,n=-1):
        if n<0: n=s.size-s.pos
        if n==0 or s.pos>=s.size: return b''
        req=urllib.request.Request(s.url,headers={'Range':f'bytes={s.pos}-{min(s.pos+n,s.size)-1}'})
        d=urllib.request.urlopen(req).read(); s.pos+=len(d); return d
    def readinto(s,b):
        d=s.read(len(b)); b[:len(d)]=d; return len(d)
def open_zip(url): return zipfile.ZipFile(io.BufferedReader(R(url),buffer_size=1<<20))
if __name__=='__main__':
    z=open_zip(sys.argv[1])
    for i in z.infolist():
        if len(sys.argv)<3 or any(k in i.filename for k in sys.argv[2:]): print(i.filename,i.compress_size,i.file_size)
