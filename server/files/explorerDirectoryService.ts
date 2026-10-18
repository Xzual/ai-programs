import {fileService,FileService} from './fileService';
/** Public metadata facade. Native descriptors are resolved only on the private bridge. */
export class ExplorerDirectoryService {
  constructor(readonly files:FileService=fileService){}
  search(query='',limit=50){return this.files.searchDirectories(query,limit);}
  resolve(id:string){return this.files.resolveExplorerDirectory(id);}
}
export const explorerDirectoryService=new ExplorerDirectoryService();
