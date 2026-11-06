import sys,json,subprocess,os
sys.stdout.reconfigure(encoding='utf-8')
D=os.path.dirname(os.path.abspath(__file__))
r=subprocess.run([sys.executable,'-I',os.path.join(D,'u.py'),'ui'],capture_output=True,text=True,encoding='utf-8').stdout
t=json.loads(r[r.find('{'):])['data']['result']
import re
print(re.sub(r'TomoBox/TomoCanvas/Frame/(Pages/MainScreen/)?','',t))
